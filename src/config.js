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
};

// Supported display currencies (mirrors the client config in public/assets/js/theme.js).
export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'];
