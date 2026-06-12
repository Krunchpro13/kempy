// src/services/seller-scan.js
//
// FR-3 — eBay seller-store reverse-scan.
//
// From a profitable result you can "Scan this seller's store": we pull the
// seller's active eBay.co.uk listings (the SELL side), reverse-match each one
// to a source product (the COST side), compute margin, and rank most-profitable
// first — reusing finalizeMock so the cards are byte-identical to research cards
// (FR-1 dual display + FR-2 identifiers come free).
//
// Direction note: this is the REVERSE of normal research (eBay → source), so it
// uses the eBay→Amazon matchers (Claude `matchAmazonProduct`, local `bestMatch`)
// rather than the source-primary `matchEbayBatch`.
//
// COST DISCIPLINE (the #1 risk — eBay Browse is 5,000 calls/day shared app-wide):
//   • cap listings per scan (SELLER_SCAN_LIMIT, default 40)
//   • one eBay seller call + ≤1 Keepa search + ≤1 Claude call per listing,
//     all cached (Keepa/Claude caches are keyed by title, so overlaps are free)
//   • whole scan cached by seller (TTL 6h) → re-scans cost nothing
//   • per-user daily scan budget enforced in the route

import { searchEbaySeller } from './ebay.js';
import { findAmazonCandidates } from './amazon.js';
import { matchAmazonProduct } from './claude.js';
import { bestMatch } from './match-local.js';
import { finalizeMock } from './mock-sources.js';
import * as aliexpress from './providers/aliexpress.js';
import * as tiktok from './providers/tiktok.js';
import { getCachedSearch, setCachedSearch, getClient } from './cache.js';
import { SEARCH, ECONOMICS } from '../config.js';

const SCAN_LIMIT = Number(process.env.SELLER_SCAN_LIMIT || 40);
const CONF_MIN = SEARCH.MATCH_CONFIDENCE_MIN;

const SOURCE_META = {
  amazon: { label: 'Amazon.co.uk', supplierUrlBase: 'https://www.amazon.co.uk/s?k=' },
  aliexpress: { label: 'AliExpress', supplierUrlBase: 'https://www.aliexpress.com/wholesale?SearchText=' },
  tiktok: { label: 'TikTok UK', supplierUrlBase: 'https://www.tiktok.com/search?q=' },
};

// Small concurrency-capped map (don't fire N upstream calls at once).
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, worker));
  return out;
}

// Reverse-match a single eBay listing to an Amazon product (Keepa + Claude/local).
async function matchAmazon(listing) {
  let candidates = [];
  try { candidates = (await findAmazonCandidates(listing.name, SEARCH.CANDIDATE_POOL)) || []; }
  catch { candidates = []; }
  if (!candidates.length) return null;

  let chosen = null, confidence = null, via;
  if (process.env.ANTHROPIC_API_KEY) {
    const d = await matchAmazonProduct({ title: listing.name }, candidates);
    if (d && d.match_index != null && candidates[d.match_index] && (d.confidence ?? 0) >= CONF_MIN) {
      chosen = candidates[d.match_index]; confidence = d.confidence ?? null; via = 'claude-match';
    }
  } else {
    const local = bestMatch(listing.name, candidates);
    if (local && local.confident) { chosen = local.candidate; confidence = local.score; via = 'local-match'; }
  }
  if (!chosen || !(chosen.amazonPrice > 0)) return null;

  return {
    sourceTitle: chosen.title, sourceImage: chosen.image, sourcePrice: chosen.amazonPrice,
    sourceUrl: chosen.url, sourceId: chosen.asin, gtin: chosen.gtin || null, via, confidence,
  };
}

// Reverse-match a single eBay listing to an AliExpress / TikTok product
// (keyword fetch + local title-overlap gate — fuzzy by nature, so we're strict).
async function matchProvider(listing, provider) {
  let products = [];
  try { products = await provider.fetchSupplierProducts(listing.name, { limit: 12 }); }
  catch { products = []; }
  if (!products.length) return null;

  // bestMatch scores against candidate.title — map the provider shape onto it.
  const cands = products.map((p) => ({ title: p.name, ...p }));
  const local = bestMatch(listing.name, cands);
  if (!local || !local.confident) return null;
  const c = local.candidate;
  if (!(c.supplierPrice > 0)) return null;

  return {
    sourceTitle: c.name, sourceImage: c.image, sourcePrice: c.supplierPrice,
    sourceUrl: c.supplierUrl, sourceId: c.productId, gtin: null,
    via: 'local-match', confidence: local.score,
  };
}

// Build a finished card from a seller listing + its (maybe-null) source match.
function buildScanCard(listing, match, { label, supplierUrlBase }) {
  const base = {
    name: listing.name,
    cat: listing.categories?.[0] || 'Marketplace',
    ebayPrice: listing.ebayPrice,
    shipping: listing.ebayShipping != null ? listing.ebayShipping : ECONOMICS.DEFAULT_SHIPPING,
    ebayUrl: listing.ebayUrl,
    ebayItemId: listing.ebayItemId,
    ebayTitle: listing.name,
    ebayImage: listing.image,
    legacyItemId: listing.legacyItemId,
    seller: listing.seller,
  };

  if (!match) {
    // Unmatched: show the listing honestly with no fabricated cost/ROI.
    const card = finalizeMock({ ...base, supplierPrice: 0, sourceTitle: null, estimated: true }, { sourceName: label, supplierUrlBase });
    card.profit = null; card.roi = null; card.amazonPrice = null; card.sourcePrice = null;
    return card;
  }

  const card = finalizeMock({
    ...base,
    supplierPrice: match.sourcePrice,
    supplierUrl: match.sourceUrl,
    image: match.sourceImage,
    sourceTitle: match.sourceTitle,
    sourceImage: match.sourceImage,
    sourceId: match.sourceId,
    productId: match.sourceId,
    asin: label.startsWith('Amazon') ? match.sourceId : null,
    gtin: match.gtin || null,
    matchVia: match.via,
    matchConfidence: match.confidence,
    estimated: false,
  }, { sourceName: label, supplierUrlBase });
  return card;
}

/**
 * Scan a seller's store and return reverse-matched, profit-ranked cards.
 * @returns {Promise<{ products, meta }>}
 */
export async function scanSeller(username, source = 'amazon', { limit = SCAN_LIMIT, q = '' } = {}) {
  const src = SOURCE_META[source] ? source : 'amazon';
  const meta = SOURCE_META[src];
  const cap = Math.min(Math.max(Number(limit) || SCAN_LIMIT, 1), 60);

  const cacheKey = `sellerscan:${src}:${String(username).toLowerCase()}:${q || '_all'}`;
  const hit = await getCachedSearch(cacheKey);
  if (hit) return { ...hit, cached: true };

  const { items, total, limited } = await searchEbaySeller(username, { limit: cap, q });
  if (!items.length) {
    return { products: [], meta: { seller: username, source: src, scanned: 0, total, matched: 0, limited }, cached: false };
  }

  const provider = src === 'aliexpress' ? aliexpress : src === 'tiktok' ? tiktok : null;
  const matched = await mapLimit(items, 4, async (listing) => {
    try {
      let m = src === 'amazon' ? await matchAmazon(listing) : await matchProvider(listing, provider);
      // Reverse-match sanity: a source costing far MORE than the eBay sale price is
      // almost certainly a different (bigger) SKU mis-matched by title — drop it
      // rather than show a misleading huge-negative ROI. (Real arbitrage = source
      // cheaper than the eBay sale.)
      if (m && listing.ebayPrice > 0 && m.sourcePrice > listing.ebayPrice * 1.5) m = null;
      return buildScanCard(listing, m, meta);
    } catch {
      return buildScanCard(listing, null, meta);
    }
  });

  // Matched (real margin) first, profit-desc; unmatched last.
  const products = matched.filter(Boolean).sort((a, b) => {
    const am = a.profit == null, bm = b.profit == null;
    if (am !== bm) return am ? 1 : -1;
    return (b.profit || 0) - (a.profit || 0);
  });

  const matchedCount = products.filter((p) => p.profit != null).length;
  const payload = {
    products,
    meta: { seller: username, source: src, scanned: items.length, total, matched: matchedCount, limited },
  };
  await setCachedSearch(cacheKey, payload);
  return { ...payload, cached: false };
}

// ---- Per-user daily scan budget (Redis-backed; fail-open when Redis is off) ----
const DAILY_BUDGET = Number(process.env.SELLER_SCAN_DAILY_BUDGET || 15);

// dayStamp is passed in by the caller (server has Date; keeps this module pure-ish).
export async function checkScanBudget(userId, dayStamp) {
  const client = getClient();
  if (!client) return { ok: true, used: 0, limit: DAILY_BUDGET, enforced: false };
  const key = `scanbudget:${userId}:${dayStamp}`;
  try {
    const used = Number(await client.get(key)) || 0;
    if (used >= DAILY_BUDGET) return { ok: false, used, limit: DAILY_BUDGET, enforced: true };
    const next = await client.incr(key);
    if (next === 1) await client.expire(key, 60 * 60 * 26); // ~1 day + slack
    return { ok: true, used: next, limit: DAILY_BUDGET, enforced: true };
  } catch {
    return { ok: true, used: 0, limit: DAILY_BUDGET, enforced: false };
  }
}
