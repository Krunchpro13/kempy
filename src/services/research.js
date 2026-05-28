// src/services/research.js
//
// Orchestrator for product research.
//
// Live mode (when EBAY_CLIENT_ID is set):
//   1. Search eBay for the query → real listings + prices
//   2. Estimate cost/profit/ROI using a placeholder supplier-cost ratio
//      (will be replaced with real Amazon/Keepa lookups in the next step)
//   3. Sort by ROI, return.
//
// Fallback mode (no keys, or eBay errors):
//   - Filter the mock product list.

import { searchEbay } from './ebay.js';
import { FALLBACK_PRODUCTS } from './fallback-data.js';

const FEE_RATE = 0.129;                 // typical eBay final value fee
const PACKAGING = 1.50;                 // rough per-order packaging cost

// Until we wire Amazon/Keepa, estimate supplier cost as eBay price × 0.72.
// That's a typical 28% gross margin on dropshipped items. We'll replace this
// with a real Amazon lookup once the Amazon service exists.
const SUPPLIER_COST_RATIO = 0.72;

// Pull a representative emoji for a query (purely cosmetic — frontend renders it)
function emojiFor(name = '') {
  const n = name.toLowerCase();
  if (/headphone|earbud|airpod|earphone/.test(n)) return '🎧';
  if (/watch|smartwatch/.test(n))                return '⌚';
  if (/cable|cord/.test(n))                       return '🔌';
  if (/charger|adapter|power/.test(n))            return '🔌';
  if (/webcam|camera/.test(n))                    return '📷';
  if (/bag|handbag|purse|tote/.test(n))           return '👜';
  if (/phone|iphone|galaxy/.test(n))              return '📱';
  if (/laptop|macbook/.test(n))                   return '💻';
  if (/keyboard/.test(n))                         return '⌨️';
  if (/mouse/.test(n))                            return '🖱️';
  if (/lamp|light/.test(n))                       return '💡';
  return '📦';
}

function round2(n) { return Math.round(n * 100) / 100; }

// Convert a raw eBay item into the shape the frontend expects.
function buildProduct(item) {
  const ebayPrice = item.ebayPrice;
  const shipping = item.ebayShipping != null ? item.ebayShipping : 6;
  const amazonPrice = round2(ebayPrice * SUPPLIER_COST_RATIO);
  const fees = round2(ebayPrice * FEE_RATE);
  const packaging = PACKAGING;
  const profit = round2(ebayPrice - amazonPrice - fees - shipping - packaging);
  const roi = amazonPrice > 0 ? round2((profit / amazonPrice) * 100) : 0;

  return {
    name: item.name,
    emoji: emojiFor(item.name),
    cat: item.categories && item.categories[0] ? item.categories[0] : 'Marketplace',
    vol: '—',                              // volume data needs Keepa
    comp: 'live',
    trend: '—',
    ebayPrice,
    amazonPrice,
    ebayUrl: item.ebayUrl,
    amazonUrl: null,                       // we don't have an Amazon match yet
    fees,
    shipping,
    packaging,
    profit,
    roi,
    asin: null,                            // populated in next phase (Amazon match)
    matchSource: 'ebay',
    image: item.image,
    condition: item.condition,
    ebayItemId: item.ebayItemId,
  };
}

export async function searchProducts(query) {
  const q = (query || '').toLowerCase().trim();

  // ----- Try live eBay first -----
  const hasEbay = !!process.env.EBAY_CLIENT_ID;
  if (hasEbay && q && q !== 'all') {
    try {
      const items = await searchEbay(query, { limit: 24 });
      if (items.length) {
        const products = items
          .map(buildProduct)
          // Drop items where supplier-cost guess would land below $0.50 (probably noise)
          .filter(p => p.amazonPrice > 0.5)
          .sort((a, b) => (b.roi || 0) - (a.roi || 0));
        return { products, cached: false, source: 'ebay' };
      }
    } catch (err) {
      console.error('[research] eBay live search failed, falling back to mock:', err.message);
      // fall through to mock
    }
  }

  // ----- Fallback: filter mock data -----
  let products = FALLBACK_PRODUCTS.slice();
  if (q && q !== 'all') {
    products = products.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.cat.toLowerCase().includes(q) ||
      (p.keywords || []).some(k => k.toLowerCase().includes(q))
    );
  }
  products.sort((a, b) => (b.roi || 0) - (a.roi || 0));
  return { products, cached: false, source: 'mock' };
}
