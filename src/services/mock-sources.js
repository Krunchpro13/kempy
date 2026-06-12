// =============================================================================
// Alternative research sources — AliExpress → eBay.co.uk and TikTok UK → eBay.co.uk
// =============================================================================
// These two modes don't have a live API wired yet, so they return realistic UK
// (GBP) sample data shaped EXACTLY like the live Amazon.co.uk→eBay.co.uk results.
// When a real AliExpress/TikTok integration lands, swap the *_PRODUCTS arrays for
// live fetches — the card shape (and the whole frontend) stays the same.
//
// `finalizeMock` is also reused by research.js for the Amazon.co.uk fallback so
// every mock card gets real fees/profit/ROI (not blanks).

import { ECONOMICS } from '../config.js';

const FEE = ECONOMICS.EBAY_FEE_RATE;
const PACK = ECONOMICS.PACKAGING_COST;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Turn a raw mock listing into the standard research-card shape (GBP base).
// `sourceName` drives the dynamic supplier-column label (Amazon.co.uk / AliExpress
// / TikTok UK); the sell side is always eBay.co.uk.
export function finalizeMock(p, { sourceName, supplierUrlBase } = {}) {
  const ebayPrice = Number(p.ebayPrice) || 0;
  const supplierPrice = Number(p.supplierPrice != null ? p.supplierPrice : p.amazonPrice) || 0;
  const shipping = p.shipping != null ? p.shipping : ECONOMICS.DEFAULT_SHIPPING;
  const packaging = p.packaging != null ? p.packaging : PACK;
  const fees = r2(ebayPrice * FEE);
  const profit = r2(ebayPrice - supplierPrice - fees - shipping - packaging);
  const roi = supplierPrice > 0 ? r2((profit / supplierPrice) * 100) : 0;

  const label = sourceName || 'Amazon.co.uk';
  const sourceUrl = p.supplierUrl || (supplierUrlBase ? supplierUrlBase + encodeURIComponent(p.name) : null);

  // Guard against "too good to be true" ROI from AliExpress DS first-order PROMO
  // prices (e.g. £0.99) that are not the real bulk cost. Flag as a lead, not gospel.
  const promoWarning = platformKey(label) === 'aliexpress' && supplierPrice > 0
    && (supplierPrice < 1.5 || roi > 300);

  return {
    name: p.name,
    cat: p.cat || 'Marketplace',
    vol: p.vol || '—',
    comp: p.comp || 'live',
    trend: p.trend || '—',
    ebayPrice,
    amazonPrice: supplierPrice,          // the card's supplier-cost column reads this
    supplierPrice,
    sourceName: label,
    ebayUrl: p.ebayUrl || 'https://www.ebay.co.uk/sch/i.html?_nkw=' + encodeURIComponent(p.name),
    amazonUrl: sourceUrl,
    fees,
    shipping,
    packaging,
    profit,
    roi,
    asin: p.asin || null,
    estimated: p.estimated != null ? p.estimated : false,
    matchSource: label,
    matchVia: p.matchVia || null,
    matchConfidence: p.matchConfidence != null ? p.matchConfidence : null,
    image: p.image || null,
    condition: p.condition || 'New',
    ebayItemId: p.ebayItemId || p.id || null,

    // ---- FR-1 dual-platform display ----
    sourcePlatform: platformKey(label),  // 'amazon' | 'aliexpress' | 'tiktok'
    sourceTitle: p.sourceTitle || p.name,
    sourceImage: p.sourceImage || p.image || null,
    sourcePrice: supplierPrice,
    sourceUrl,
    ebayTitle: p.ebayTitle || null,      // distinct matched-eBay-listing title (null = same as name)
    ebayImage: p.ebayImage || null,      // distinct matched-eBay-listing image

    // ---- FR-2 cross-platform identifiers ----
    sourceId: p.sourceId || p.productId || (p.asin || null),  // ASIN / AliExpress id / TikTok id
    gtin: p.gtin || null,                                     // GTIN/EAN/UPC where available
    ebayItemNumber: p.legacyItemId || p.ebayItemNumber || null,

    // ---- FR-4 quality signals ----
    prime: p.prime ?? null,        // Amazon buy-box Prime eligibility (true | null); only set when Prime-only on
    promoWarning,                  // true = source price looks like a promo, ROI is a lead not a guarantee
  };
}

// Map a supplier label to a short platform key used by the FR-2 identifier row.
function platformKey(name = '') {
  const n = name.toLowerCase();
  if (n.includes('aliexpress')) return 'aliexpress';
  if (n.includes('tiktok')) return 'tiktok';
  return 'amazon';
}

function filterAndBuild(list, q, opts) {
  const query = (q || '').toLowerCase().trim();
  let items = (!query || query === 'all' || query === '*')
    ? list
    : list.filter((p) =>
        p.name.toLowerCase().includes(query) ||
        (p.cat || '').toLowerCase().includes(query) ||
        (p.keywords || []).some((k) => k.includes(query) || query.includes(k)));
  if (!items.length) items = list; // demo-friendly: always show opportunities
  return items
    .map((p) => finalizeMock(p, opts))
    .sort((a, b) => (b.roi || 0) - (a.roi || 0));
}

// ---------------------------------------------------------------------------
// AliExpress → eBay.co.uk : cheap overseas supply, marked up for UK buyers.
// ---------------------------------------------------------------------------
export const ALIEXPRESS_PRODUCTS = [
  { name: 'LED Strip Lights 10m RGB (App + Remote)', cat: 'Home > Lighting', supplierPrice: 4.80, ebayPrice: 16.99, shipping: 1.2, packaging: 0.5, vol: 4200, comp: 'High', trend: 'Growing', keywords: ['led', 'strip', 'lights', 'rgb', 'home'] },
  { name: 'Magnetic Phone Mount for Car', cat: 'Automotive > Accessories', supplierPrice: 2.10, ebayPrice: 11.99, shipping: 1, packaging: 0.4, vol: 3100, comp: 'Medium', trend: 'Growing', keywords: ['phone', 'mount', 'car', 'magnetic', 'holder'] },
  { name: 'Mini Portable Bluetooth Speaker', cat: 'Electronics > Audio', supplierPrice: 5.40, ebayPrice: 18.99, shipping: 1.5, packaging: 0.6, vol: 2700, comp: 'High', trend: 'Stable', keywords: ['speaker', 'bluetooth', 'portable', 'audio'] },
  { name: 'Stainless Steel Insulated Water Bottle 750ml', cat: 'Home > Kitchen', supplierPrice: 3.90, ebayPrice: 14.49, shipping: 1.4, packaging: 0.6, vol: 1900, comp: 'Medium', trend: 'Growing', keywords: ['bottle', 'water', 'flask', 'insulated', 'kitchen'] },
  { name: 'Posture Corrector Back Support', cat: 'Health > Wellness', supplierPrice: 2.70, ebayPrice: 12.99, shipping: 1, packaging: 0.5, vol: 2400, comp: 'Medium', trend: 'Growing', keywords: ['posture', 'back', 'support', 'health', 'brace'] },
  { name: 'Resistance Bands Set (5-piece)', cat: 'Sports > Fitness', supplierPrice: 3.20, ebayPrice: 13.49, shipping: 1.1, packaging: 0.5, vol: 2050, comp: 'Medium', trend: 'Stable', keywords: ['resistance', 'bands', 'fitness', 'gym', 'exercise'] },
  { name: 'Galaxy Star Projector Night Light', cat: 'Home > Lighting', supplierPrice: 6.10, ebayPrice: 22.99, shipping: 1.6, packaging: 0.7, vol: 3600, comp: 'High', trend: 'Growing', keywords: ['projector', 'star', 'galaxy', 'night', 'light'] },
  { name: 'Wireless Earbuds (TWS, charging case)', cat: 'Electronics > Audio', supplierPrice: 4.60, ebayPrice: 17.99, shipping: 1.3, packaging: 0.6, vol: 5200, comp: 'Very High', trend: 'Stable', keywords: ['earbuds', 'wireless', 'tws', 'headphones', 'audio'] },
];

// ---------------------------------------------------------------------------
// TikTok UK → eBay.co.uk : products trending on #TikTokMadeMeBuyIt (UK region),
// sourced cheaply and resold to UK buyers chasing the trend.
// ---------------------------------------------------------------------------
export const TIKTOK_PRODUCTS = [
  { name: 'Mini Portable Blender (USB Rechargeable)', cat: 'Home > Kitchen', supplierPrice: 6.80, ebayPrice: 21.99, shipping: 1.6, packaging: 0.7, vol: 8900, comp: 'High', trend: 'Viral', keywords: ['blender', 'portable', 'smoothie', 'kitchen', 'tiktok'] },
  { name: 'Stanley-Style 1.2L Tumbler with Straw', cat: 'Home > Kitchen', supplierPrice: 7.50, ebayPrice: 24.99, shipping: 1.8, packaging: 0.8, vol: 12400, comp: 'Very High', trend: 'Viral', keywords: ['tumbler', 'cup', 'stanley', 'flask', 'trending'] },
  { name: 'LED Sunset Lamp Projector', cat: 'Home > Lighting', supplierPrice: 3.40, ebayPrice: 13.99, shipping: 1.1, packaging: 0.5, vol: 7300, comp: 'High', trend: 'Viral', keywords: ['sunset', 'lamp', 'projector', 'light', 'aesthetic'] },
  { name: 'Heatless Hair Curler Set', cat: 'Beauty > Hair', supplierPrice: 2.90, ebayPrice: 12.49, shipping: 1, packaging: 0.4, vol: 9600, comp: 'High', trend: 'Viral', keywords: ['hair', 'curler', 'heatless', 'beauty', 'overnight'] },
  { name: 'Mini Electric Foam Cleaner Spray', cat: 'Automotive > Care', supplierPrice: 4.10, ebayPrice: 15.99, shipping: 1.3, packaging: 0.6, vol: 6100, comp: 'Medium', trend: 'Viral', keywords: ['cleaner', 'foam', 'car', 'spray', 'detailing'] },
  { name: 'Cloud Slippers (Pillow Slides)', cat: 'Fashion > Footwear', supplierPrice: 2.50, ebayPrice: 11.99, shipping: 1, packaging: 0.5, vol: 10800, comp: 'High', trend: 'Viral', keywords: ['slippers', 'slides', 'cloud', 'comfy', 'shoes'] },
  { name: 'Magnetic Eyelashes with Eyeliner Kit', cat: 'Beauty > Makeup', supplierPrice: 3.10, ebayPrice: 13.49, shipping: 1, packaging: 0.4, vol: 5400, comp: 'High', trend: 'Growing', keywords: ['eyelashes', 'magnetic', 'makeup', 'beauty', 'lashes'] },
  { name: 'Smart LED Face Mask (Light Therapy)', cat: 'Beauty > Skincare', supplierPrice: 8.90, ebayPrice: 29.99, shipping: 2, packaging: 0.9, vol: 4700, comp: 'Medium', trend: 'Viral', keywords: ['face', 'mask', 'led', 'skincare', 'therapy'] },
];

export function searchAliExpress(q) {
  return filterAndBuild(ALIEXPRESS_PRODUCTS, q, {
    sourceName: 'AliExpress',
    supplierUrlBase: 'https://www.aliexpress.com/wholesale?SearchText=',
  });
}

export function searchTikTok(q) {
  return filterAndBuild(TIKTOK_PRODUCTS, q, {
    sourceName: 'TikTok UK',
    supplierUrlBase: 'https://www.tiktok.com/search?q=',
  });
}
