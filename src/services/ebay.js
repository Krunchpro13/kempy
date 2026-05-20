// =============================================================================
// eBay Browse API client
// =============================================================================
// Uses Client Credentials OAuth flow. Token is cached in memory and refreshed
// automatically before expiry.
//
// Returns ACTIVE listings (not sold). For sold-listing data you would need
// approval for the Marketplace Insights API (gated by eBay).
//
// Docs: https://developer.ebay.com/api-docs/buy/browse/overview.html
// =============================================================================

import axios from 'axios';

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const BROWSE_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
const SCOPE = 'https://api.ebay.com/oauth/api_scope';

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  // Refresh 60s before expiry
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const id = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error('EBAY_CLIENT_ID / EBAY_CLIENT_SECRET not set');
  }

  const auth = Buffer.from(`${id}:${secret}`).toString('base64');

  const { data } = await axios.post(
    TOKEN_URL,
    new URLSearchParams({
      grant_type: 'client_credentials',
      scope: SCOPE,
    }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${auth}`,
      },
      timeout: 10_000,
    }
  );

  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;
  return cachedToken;
}

/**
 * Search active eBay listings for a keyword.
 * Returns null if API keys not configured (so caller can fall back to mock).
 *
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<Array<EbayListing> | null>}
 */
export async function searchEbay(query, limit = 8) {
  if (!process.env.EBAY_CLIENT_ID) return null;

  const token = await getAccessToken();
  const marketplace = process.env.EBAY_MARKETPLACE || 'EBAY_US';

  const { data } = await axios.get(BROWSE_URL, {
    params: {
      q: query,
      limit,
      filter: 'conditionIds:{1000},buyingOptions:{FIXED_PRICE}',
      sort: '-watchCount', // proxy for popularity
    },
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': marketplace,
      'Content-Type': 'application/json',
    },
    timeout: 10_000,
  });

  const items = data.itemSummaries || [];

  return items
    .map((item) => ({
      title: item.title,
      ebayPrice: parseFloat(item.price?.value || 0),
      currency: item.price?.currency || 'USD',
      image: item.image?.imageUrl,
      itemId: item.itemId,
      sellerUsername: item.seller?.username,
      sellerFeedback: parseFloat(item.seller?.feedbackPercentage || 0),
      url: item.itemWebUrl,
      condition: item.condition,
      shippingCost: parseFloat(
        item.shippingOptions?.[0]?.shippingCost?.value || 0
      ),
      watchCount: item.watchCount || 0,
    }))
    .filter((i) => i.ebayPrice > 0);
}

/**
 * @typedef EbayListing
 * @property {string} title
 * @property {number} ebayPrice
 * @property {string} currency
 * @property {string} image
 * @property {string} itemId
 * @property {string} sellerUsername
 * @property {number} sellerFeedback
 * @property {string} url
 * @property {string} condition
 * @property {number} shippingCost
 * @property {number} watchCount
 */
