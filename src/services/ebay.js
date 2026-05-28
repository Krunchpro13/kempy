// src/services/ebay.js
//
// Talks to eBay's Browse API to find live listings.
//
// Flow:
//   1. Get an OAuth "application access token" using EBAY_CLIENT_ID / EBAY_CLIENT_SECRET
//      (these tokens are app-level, not user-level — perfect for searching public listings).
//      Tokens last ~2 hours; we cache in memory and refresh 60s before expiry.
//   2. Call /buy/browse/v1/item_summary/search?q=... to get matching listings.
//   3. Map eBay's response shape to the same shape our research engine + frontend expect.
//
// Docs: https://developer.ebay.com/api-docs/buy/browse/static/overview.html

import axios from 'axios';

const TOKEN_URL  = 'https://api.ebay.com/identity/v1/oauth2/token';
const SEARCH_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
const SCOPE      = 'https://api.ebay.com/oauth/api_scope';

// ---------- token cache (in-memory, single-process) ----------
let cachedToken = null;          // { value: 'v^1...', expiresAt: 173... }

function isConfigured() {
  return !!(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET);
}

async function getAccessToken() {
  // Reuse cached token if it has >60s left
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.value;
  }

  const id = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;
  const basic = Buffer.from(`${id}:${secret}`).toString('base64');

  const res = await axios.post(
    TOKEN_URL,
    new URLSearchParams({ grant_type: 'client_credentials', scope: SCOPE }),
    {
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 8000,
    },
  );

  const { access_token, expires_in } = res.data;
  cachedToken = {
    value: access_token,
    expiresAt: Date.now() + expires_in * 1000,
  };
  return access_token;
}

// ---------- search ----------
//
// Returns a list of normalized listing objects. We return raw eBay data
// (eBay-only, no Amazon pricing yet) — research.js will combine it with
// supplier-side prices to compute profit.

export async function searchEbay(query, { limit = 20 } = {}) {
  if (!isConfigured()) {
    throw new Error('EBAY_CLIENT_ID / EBAY_CLIENT_SECRET not set');
  }

  const token = await getAccessToken();
  const res = await axios.get(SEARCH_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      // EBAY_US — change to EBAY_GB / EBAY_DE / etc for other markets later
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      'X-EBAY-C-ENDUSERCTX': 'contextualLocation=country=US,zip=10001',
    },
    params: {
      q: query,
      limit,
      // filter to fixed-price BUY-IT-NOW listings — auctions distort price signals
      filter: 'buyingOptions:{FIXED_PRICE}',
      // sort by relevance (default) — we'll re-sort by ROI in research.js
    },
    timeout: 10000,
  });

  const items = (res.data && res.data.itemSummaries) || [];
  return items.map(mapItem).filter(Boolean);
}

// ---------- response mapper ----------
//
// eBay's response is rich; we keep only what we need + normalize prices to numbers.

function mapItem(it) {
  const price = parsePrice(it.price);
  const shipping = parseShipping(it.shippingOptions);
  if (price == null) return null;

  return {
    ebayItemId: it.itemId,
    name: it.title,
    ebayPrice: price,
    ebayShipping: shipping,                 // 0 if free, null if unknown
    ebayUrl: it.itemWebUrl,
    image: it.image && it.image.imageUrl,
    condition: it.condition,                // "New", "Used", etc.
    seller: it.seller && it.seller.username,
    sellerFeedback: it.seller && it.seller.feedbackPercentage,
    sellerScore: it.seller && it.seller.feedbackScore,
    categories: (it.categories || []).map(c => c.categoryName),
    location: it.itemLocation && it.itemLocation.country,
  };
}

function parsePrice(p) {
  if (!p || p.value == null) return null;
  const n = Number(p.value);
  return Number.isFinite(n) ? n : null;
}

function parseShipping(opts) {
  if (!Array.isArray(opts) || !opts.length) return null;
  const cost = opts[0].shippingCost;
  if (!cost) return 0;
  const n = Number(cost.value);
  return Number.isFinite(n) ? n : null;
}

// ---------- public health/info ----------

export function ebayStatus() {
  return {
    configured: isConfigured(),
    tokenCached: !!cachedToken,
    tokenExpiresIn: cachedToken
      ? Math.max(0, Math.floor((cachedToken.expiresAt - Date.now()) / 1000))
      : null,
  };
}
