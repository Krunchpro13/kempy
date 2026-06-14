// =============================================================================
// Central configuration — business constants and tunables in one place.
// Economic values are env-overridable so the owner can adjust without a deploy.
// =============================================================================

const num = (v, fallback) => (v != null && v !== '' && isFinite(Number(v)) ? Number(v) : fallback);

// eBay-vs-Amazon arbitrage economics.
export const ECONOMICS = {
  EBAY_FEE_RATE: num(process.env.EBAY_FEE_RATE, 0.129),      // eBay final-value fee
  PACKAGING_COST: num(process.env.PACKAGING_COST, 1.50),     // per-order packaging
  DEFAULT_SHIPPING: num(process.env.DEFAULT_SHIPPING, 6),    // when a listing has none
  ESTIMATE_RATIO: num(process.env.AMAZON_ESTIMATE_RATIO, 0.72), // amazon≈ebay*ratio when unmatched
};

// Search / matching tunables.
export const SEARCH = {
  EBAY_LIMIT: num(process.env.EBAY_SEARCH_LIMIT, 24),        // eBay listings per query
  CANDIDATE_POOL: num(process.env.KEEPA_CANDIDATES, 20),     // Amazon candidates per query
  MATCH_CONFIDENCE_MIN: num(process.env.MATCH_CONFIDENCE_MIN, 0.6), // Claude match threshold
  // How many source products get an eBay price-lookup per search, and how many
  // of those lookups run in parallel. Higher LIMIT = more results (but more eBay
  // calls against the shared 5,000/day quota); higher CONCURRENCY = faster.
  ENRICH_LIMIT: num(process.env.ENRICH_LIMIT, 18),
  ENRICH_CONCURRENCY: num(process.env.ENRICH_CONCURRENCY, 8),
};

// Pack-size / unit-quantity normalisation (see services/unit-normalize.js).
// Guards against matching a small Amazon pack to a large eBay multipack and
// pricing the sale against a single small cost.
export const NORMALIZE = {
  RATIO_TOLERANCE: num(process.env.MATCH_SIZE_TOLERANCE, 0.1),  // ±10% counts as the same size
  PACK_CAP: num(process.env.MATCH_PACK_CAP, 60),               // max plausible pack-multiple to auto-cost
};

// Supported display currencies (mirrors the client config in public/assets/js/theme.js).
export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'];
