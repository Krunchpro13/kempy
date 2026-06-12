// src/services/research.js
//
// Product research engine. ALL sources are now "source-primary": the search
// starts from the SOURCE marketplace (where you buy) and looks up the eBay.co.uk
// sale price (where you sell) for each product. This is the arbitrage-correct
// direction — find a cheap product on the source, then check what it flips for.
//
//   amazon     → Keepa search        → eBay.co.uk price  (enrichWithEbay)
//   aliexpress → AliExpress DS feeds  → eBay.co.uk price  (enrichWithEbay)
//   tiktok     → EchoTik trending     → eBay.co.uk price  (enrichWithEbay)
//
// Each mode is LIVE when its provider keys are set; otherwise it falls back to
// the mock sample feed so the UI always works. Cards with no eBay comparable
// are dropped (no sale price → no real profit/ROI), so every card is actionable.

import { getCachedSearch, setCachedSearch } from './cache.js';
import { FALLBACK_PRODUCTS } from './fallback-data.js';
import { finalizeMock, searchAliExpress, searchTikTok } from './mock-sources.js';
import * as amazon from './amazon.js';
import * as aliexpress from './providers/aliexpress.js';
import * as tiktok from './providers/tiktok.js';
import { enrichWithEbay } from './providers/enrich.js';
import { SEARCH } from '../config.js';

// Amazon.co.uk mock feed (used when Keepa/eBay keys are missing or return nothing).
function searchAmazonMock(query) {
  const q = (query || '').toLowerCase().trim();
  let raw = FALLBACK_PRODUCTS.slice();
  if (q && q !== 'all') {
    raw = raw.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.cat.toLowerCase().includes(q) ||
      (p.keywords || []).some(k => k.toLowerCase().includes(q))
    );
  }
  return raw
    .map(p => finalizeMock(p, { sourceName: 'Amazon.co.uk', supplierUrlBase: 'https://www.amazon.co.uk/s?k=' }))
    .sort((a, b) => (b.roi || 0) - (a.roi || 0));
}

// Per-source config: the provider module (live), the supplier-column label,
// a fallback supplier search URL, and the mock sample feed.
const PROVIDERS = {
  amazon: {
    provider: amazon,
    sourceName: 'Amazon.co.uk',
    supplierUrlBase: 'https://www.amazon.co.uk/s?k=',
    mock: searchAmazonMock,
  },
  aliexpress: {
    provider: aliexpress,
    sourceName: 'AliExpress',
    supplierUrlBase: 'https://www.aliexpress.com/wholesale?SearchText=',
    mock: searchAliExpress,
  },
  tiktok: {
    provider: tiktok,
    sourceName: 'TikTok UK',
    supplierUrlBase: 'https://www.tiktok.com/search?q=',
    mock: searchTikTok,
  },
};

// Run a source: live provider (keys present) → eBay-priced cards, with a cache
// layer and graceful fallback to the mock sample feed on any miss/error.
async function searchSource(sourceKey, query, q, opts = {}) {
  const cfg = PROVIDERS[sourceKey];
  const { provider, sourceName, supplierUrlBase, mock } = cfg;
  // FR-4b: Prime-only is an Amazon concept (AliExpress/TikTok have no Prime).
  const primeOnly = !!opts.primeOnly && sourceKey === 'amazon';
  const mockResult = () => ({ products: mock(query), source: sourceKey, realCount: 0, live: false, cached: false });

  if (!provider.isConfigured()) return mockResult();

  // Prime-enriched results differ from plain ones → keep them in a separate cache slot.
  const cacheKey = `${sourceKey}:${q || '_trending'}${primeOnly ? ':prime' : ''}`;
  const hit = await getCachedSearch(cacheKey);
  if (hit) return { ...hit, cached: true };

  try {
    const supplier = await provider.fetchSupplierProducts(query, { limit: SEARCH.EBAY_LIMIT, primeOnly });
    if (supplier.length) {
      const products = await enrichWithEbay(supplier, { sourceName, supplierUrlBase });
      if (products.length) {
        const payload = { products, source: sourceKey, realCount: products.length, live: true };
        await setCachedSearch(cacheKey, payload);
        return { ...payload, cached: false };
      }
    }
    console.error(`[research] ${sourceKey}: provider returned no usable products, using mock`);
  } catch (err) {
    console.error(`[research] ${sourceKey} provider failed, using mock:`, err.message);
  }
  return mockResult();
}

// Public API: search a given source (default Amazon). Always returns
// { products, source, realCount, live, cached }.
export async function searchProducts(query, source = 'amazon', opts = {}) {
  const q = (query || '').toLowerCase().trim();
  const key = PROVIDERS[source] ? source : 'amazon';
  return searchSource(key, query, q, opts);
}
