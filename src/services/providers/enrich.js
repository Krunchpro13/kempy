// src/services/providers/enrich.js
//
// Turns source-side products (Amazon / AliExpress / TikTok) into full arbitrage
// cards by looking up what each one SELLS for on eBay.co.uk.
//
// Arbitrage needs two prices: the source cost (we have it) and the eBay sell
// price (we don't). For each source product we:
//   1. Search eBay.co.uk for candidate resale listings (with a recall retry for
//      messy/keyword-stuffed titles, so a bad query doesn't look like a gap).
//   2. Ask Claude — in ONE batched call — which candidates are GENUINELY the
//      same product, so we price from confirmed comparables (not a blind median
//      over loosely-related results) and can tell a real market gap apart from a
//      search miss.
//   3. Compute fees/profit/ROI via finalizeMock — the exact same card shape as
//      every other research result, so the frontend needs zero changes.
//
// When no ANTHROPIC_API_KEY is set, step 2 is skipped and we fall back to the
// median-over-all-candidates heuristic. Cards with no eBay comparable are
// dropped (no sale price → no real arbitrage), so every card stays actionable.

import { searchEbay } from '../ebay.js';
import { finalizeMock } from '../mock-sources.js';
import { matchEbayBatch } from '../claude.js';
import { ECONOMICS, SEARCH } from '../../config.js';

const CONF_MIN = SEARCH.MATCH_CONFIDENCE_MIN;

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

// Source titles (esp. TikTok/AliExpress) are long and keyword-stuffed, which
// throws off eBay search. Trim to the first ~8 meaningful words, drop punctuation/specs.
function searchTermFor(name) {
  const cleaned = String(name)
    .replace(/[|/\\]+/g, ' ')
    .replace(/[^A-Za-z0-9 .'-]/g, ' ')          // strip emoji/symbols
    .replace(/\b\d+(ml|g|kg|cm|mm|pcs?|pack|x)\b/gi, ' ') // drop size/qty specs
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.split(' ').slice(0, 8).join(' ') || cleaned;
}

// Fetch candidate eBay listings for a source product. If the trimmed query
// returns little, retry with a tighter (first-4-words) query and merge — this
// covers the "messy title found nothing" failure mode before Claude even runs.
async function ebayCandidates(name) {
  const q1 = searchTermFor(name);
  let items = [];
  try { items = await searchEbay(q1, { limit: 6 }); } catch { items = []; }

  if (items.length < 2) {
    const q2 = q1.split(' ').slice(0, 4).join(' ');
    if (q2 && q2 !== q1) {
      try {
        const more = await searchEbay(q2, { limit: 6 });
        const seen = new Set(items.map((it) => it.ebayItemId));
        for (const m of more) {
          if (!seen.has(m.ebayItemId)) { items.push(m); seen.add(m.ebayItemId); }
        }
      } catch { /* keep what we have */ }
    }
  }

  return items
    .filter((it) => Number.isFinite(it.ebayPrice) && it.ebayPrice > 0)
    .slice(0, 6);
}

// Representative eBay sell price + reference listing from a set of confirmed
// comparable listings (median price; nearest-median listing for link/title/image/id).
function priceFromListings(listings) {
  const price = median(listings.map((l) => l.ebayPrice));
  if (price == null) return null;
  const ref = listings
    .filter((it) => Number.isFinite(it.ebayPrice))
    .sort((a, b) => Math.abs(a.ebayPrice - price) - Math.abs(b.ebayPrice - price))[0];
  return {
    ebayPrice: Math.round(price * 100) / 100,
    shipping: ref?.ebayShipping != null ? ref.ebayShipping : ECONOMICS.DEFAULT_SHIPPING,
    ebayUrl: ref?.ebayUrl || null,
    ebayItemId: ref?.ebayItemId || null,
    ebayTitle: ref?.name || null,
    ebayImage: ref?.image || null,
    legacyItemId: ref?.legacyItemId || null,
    seller: ref?.seller || null,            // FR-3: enables "Scan this seller's store"
  };
}

// Enrich source products into finished cards.
//   products       : normalized source products ({ name, supplierPrice, ... })
//   sourceName     : source-column label ('Amazon.co.uk' | 'AliExpress' | 'TikTok UK')
//   supplierUrlBase: fallback source search URL when a product has no direct link
// Cards with no confirmed eBay comparable are dropped (can't compute real arbitrage).
export async function enrichWithEbay(products, { sourceName, supplierUrlBase } = {}) {
  if (!products.length) return [];
  const top = products.slice(0, SEARCH.ENRICH_LIMIT);   // how many products to price (tunable)

  // 1) Candidate eBay listings for each source product (concurrency-capped, tunable).
  const candidatesPer = await mapLimit(top, SEARCH.ENRICH_CONCURRENCY, (p) => ebayCandidates(p.name));

  // 2) ONE Claude call to confirm the genuinely-matching listings per product.
  //    null when no key / error → fall back to the median heuristic per product.
  const claudeMatches = await matchEbayBatch(
    top.map((p, i) => ({
      title: p.name,
      candidates: candidatesPer[i].map((l) => ({ title: l.name, price: l.ebayPrice })),
    })),
  );

  // 3) Build cards.
  const cards = top.map((p, i) => {
    const listings = candidatesPer[i];
    if (!listings.length) return null;                 // no eBay results at all → gap

    let matched = listings;                            // default (no-Claude) = all candidates
    let via = 'ebay-browse';
    let confidence = null;

    const cm = claudeMatches ? claudeMatches[i] : null;
    if (cm) {
      // Claude ran for this product: trust it. Low confidence or no matches → genuine gap → drop.
      if (!(cm.confidence >= CONF_MIN) || !cm.match_indices.length) return null;
      matched = cm.match_indices.map((idx) => listings[idx]).filter(Boolean);
      if (!matched.length) return null;
      via = 'claude-match';
      confidence = cm.confidence;
    }

    const ebay = priceFromListings(matched);
    if (!ebay) return null;

    const card = finalizeMock(
      {
        ...p,
        ebayPrice: ebay.ebayPrice,
        shipping: ebay.shipping,
        ebayUrl: ebay.ebayUrl,
        ebayItemId: ebay.ebayItemId,
        ebayTitle: ebay.ebayTitle,           // FR-1 dual display
        ebayImage: ebay.ebayImage,
        sourceImage: p.image,                // source-side image
        sourceId: p.productId,               // FR-2 source id (ASIN / AliExpress / TikTok)
        legacyItemId: ebay.legacyItemId,     // FR-2 eBay item number
        seller: ebay.seller,                 // FR-3 seller-scan anchor
        matchVia: via,                       // 'claude-match' | 'ebay-browse'
        matchConfidence: confidence,
        estimated: false,
      },
      { sourceName, supplierUrlBase },
    );
    card.matchSource = sourceName;
    return card;
  });

  return cards
    .filter(Boolean)
    .filter((c) => c.ebayPrice > 0 && c.amazonPrice > 0)
    .sort((a, b) => (b.roi || 0) - (a.roi || 0));
}
