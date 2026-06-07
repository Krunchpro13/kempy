// src/services/providers/enrich.js
//
// Turns supplier-side products (from AliExpress / TikTok providers) into full
// arbitrage cards by looking up what each one SELLS for on eBay.co.uk.
//
// Arbitrage needs two prices: the supplier cost (we have it) and the eBay sell
// price (we don't). For each supplier product we run one eBay Browse search,
// take a representative sell price from the live listings, then compute
// fees/profit/ROI via finalizeMock — the exact same card shape as every other
// research result, so the frontend needs zero changes.

import { searchEbay } from '../ebay.js';
import { finalizeMock } from '../mock-sources.js';
import { ECONOMICS } from '../../config.js';

const median = (nums) => {
  const a = nums.filter((n) => Number.isFinite(n) && n > 0).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
};

// Run async tasks with a small concurrency cap so we don't fire N eBay calls at once.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// Supplier titles (esp. TikTok) are long and keyword-stuffed, which throws off
// eBay search. Trim to the first ~8 meaningful words, drop punctuation/specs.
function searchTermFor(name) {
  const cleaned = String(name)
    .replace(/[|/\\]+/g, ' ')
    .replace(/[^A-Za-z0-9 .'-]/g, ' ')          // strip emoji/symbols
    .replace(/\b\d+(ml|g|kg|cm|mm|pcs?|pack|x)\b/gi, ' ') // drop size/qty specs
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.split(' ').slice(0, 8).join(' ') || cleaned;
}

// Find a representative eBay.co.uk sell price for a supplier product.
// Returns { ebayPrice, shipping, ebayUrl, ebayItemId } or null if no comparable.
async function ebayPriceFor(name) {
  let items = [];
  try {
    items = await searchEbay(searchTermFor(name), { limit: 5 });
  } catch {
    return null;
  }
  if (!items.length) return null;
  const price = median(items.map((it) => it.ebayPrice));
  if (price == null) return null;
  // Pick the listing closest to the median for the link/shipping signal.
  const ref = items
    .filter((it) => Number.isFinite(it.ebayPrice))
    .sort((a, b) => Math.abs(a.ebayPrice - price) - Math.abs(b.ebayPrice - price))[0];
  return {
    ebayPrice: Math.round(price * 100) / 100,
    shipping: ref?.ebayShipping != null ? ref.ebayShipping : ECONOMICS.DEFAULT_SHIPPING,
    ebayUrl: ref?.ebayUrl || null,
    ebayItemId: ref?.ebayItemId || null,
  };
}

// Enrich supplier products into finished cards.
//   products      : normalized supplier products ({name, supplierPrice, ...})
//   sourceName    : supplier-column label ('AliExpress' | 'TikTok UK')
//   supplierUrlBase: fallback supplier search URL when a product has no direct link
// Cards with no eBay comparable are dropped (can't compute real arbitrage).
export async function enrichWithEbay(products, { sourceName, supplierUrlBase } = {}) {
  if (!products.length) return [];
  const top = products.slice(0, 12);                 // cap eBay calls per search
  const enriched = await mapLimit(top, 4, async (p) => {
    const ebay = await ebayPriceFor(p.name);
    if (!ebay) return null;
    const card = finalizeMock(
      { ...p, ebayPrice: ebay.ebayPrice, shipping: ebay.shipping },
      { sourceName, supplierUrlBase },
    );
    // Prefer the real supplier/eBay links + id from live data.
    card.ebayUrl = ebay.ebayUrl || card.ebayUrl;
    card.ebayItemId = ebay.ebayItemId || card.ebayItemId;
    if (p.supplierUrl) card.amazonUrl = p.supplierUrl;
    card.estimated = false;
    card.matchSource = sourceName;
    card.matchVia = 'ebay-browse';
    return card;
  });
  return enriched
    .filter(Boolean)
    .filter((c) => c.ebayPrice > 0 && c.amazonPrice > 0)
    .sort((a, b) => (b.roi || 0) - (a.roi || 0));
}
