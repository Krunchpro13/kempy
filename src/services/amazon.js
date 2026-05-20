// =============================================================================
// Amazon price client (via Keepa API)
// =============================================================================
// Keepa is the most realistic source for Amazon price data without
// Amazon Associate sales history (PA-API requirement).
//
// Pricing model: ~$20/mo for 100 tokens/min. Each search ≈ 1 token,
// each multi-ASIN product detail call ≈ N tokens.
//
// Docs: https://keepa.com/#!discuss/t/product-finder-api/2858
// =============================================================================

import axios from 'axios';
import { getCachedKeepa, setCachedKeepa } from './cache.js';

const KEEPA_BASE = 'https://api.keepa.com';

/**
 * Search Amazon (via Keepa) and return up to N candidate products,
 * each with title + current price + ASIN. Used by the Claude matcher
 * to pick the best match.
 *
 * Returns null if Keepa key not set, empty array if no results.
 *
 * @param {string} query
 * @param {number} n  Maximum candidates to return (default 5)
 * @returns {Promise<Array<AmazonProduct> | null>}
 */
export async function findAmazonCandidates(query, n = 5) {
  if (!process.env.KEEPA_API_KEY) return null;

  // Cache check — saves a Keepa token (real money) on hit
  const cached = await getCachedKeepa(query);
  if (cached) return cached.slice(0, n);

  const domain = process.env.KEEPA_DOMAIN || 1;

  // Step 1 — search for ASINs matching the query
  const searchResp = await axios.get(`${KEEPA_BASE}/search`, {
    params: {
      key: process.env.KEEPA_API_KEY,
      domain,
      type: 'product',
      term: query,
      page: 0,
    },
    timeout: 15_000,
  });

  const asins = searchResp.data?.asinList?.slice(0, n) || [];
  if (asins.length === 0) return [];

  // Step 2 — single batch call for all candidate prices/titles
  const productResp = await axios.get(`${KEEPA_BASE}/product`, {
    params: {
      key: process.env.KEEPA_API_KEY,
      domain,
      asin: asins.join(','),
      stats: 1,
    },
    timeout: 20_000,
  });

  const products = productResp.data?.products || [];

  const mapped = products
    .map((p) => {
      const currentCents = p.stats?.current?.[0];
      const amazonPrice = currentCents > 0 ? currentCents / 100 : null;
      const firstImage = p.imagesCSV?.split(',')[0];
      return {
        asin: p.asin,
        title: p.title,
        brand: p.brand,
        amazonPrice,
        image: firstImage
          ? `https://images-na.ssl-images-amazon.com/images/I/${firstImage}`
          : null,
        url: `https://www.amazon.com/dp/${p.asin}`,
        avgRating: p.avgRating ? p.avgRating / 10 : null,
        reviewCount: p.reviewCount || 0,
      };
    })
    .filter((p) => p.amazonPrice != null);

  // Cache full candidate list (n is just a slicing hint at read time)
  await setCachedKeepa(query, mapped);

  return mapped.slice(0, n);
}

/**
 * Legacy: single best-guess match (just returns first candidate).
 * Kept for compatibility — new code should use findAmazonCandidates +
 * the Claude matcher.
 */
export async function findAmazonProduct(query) {
  const candidates = await findAmazonCandidates(query, 1);
  return candidates && candidates.length > 0 ? candidates[0] : null;
}

/**
 * @typedef AmazonProduct
 * @property {string} asin
 * @property {string} title
 * @property {string} brand
 * @property {number} amazonPrice
 * @property {string} image
 * @property {number} reviewCount
 * @property {number} avgRating
 * @property {string} url
 */

