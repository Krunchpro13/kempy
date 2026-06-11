// src/services/providers/aliexpress.js
//
// Live AliExpress supply-side feed via the AliExpress DROPSHIPPING (DS) API.
// (The account is registered for the DS API, not the Affiliate API — and the DS
// API has NO keyword product search. So we pull AliExpress's best-seller /
// recommended FEEDS as a live catalog of winning products, then keyword-filter
// that catalog client-side. Empty query -> the trending feed.)
//
// research.js prices each product against eBay.co.uk (providers/enrich.js) to
// compute profit/ROI. Auth is the app-level OAuth token (see aliexpress-oauth.js);
// until the owner connects, getValidAccessToken() returns null -> we throw ->
// research.js falls back to the mock sample feed.
//
// Methods used (DS, /sync gateway, signed, session=access token):
//   aliexpress.ds.feedname.get        -> list available feed names
//   aliexpress.ds.recommend.feed.get  -> products for a feed (Affiliate product shape)

import { callSigned, getValidAccessToken, isConfigured as oauthConfigured } from './aliexpress-oauth.js';

// Default feeds to pull when AE's feedname list is unavailable. AE's canonical
// dropship feeds; overridable via env (comma-separated).
// Real DS feed names (from aliexpress.ds.feedname.get). Big global bestseller
// feeds work well as a trending catalog. Override/extend via ALIEXPRESS_FEEDS.
const DEFAULT_FEEDS = (process.env.ALIEXPRESS_FEEDS || 'AEB_Droplo_BestsellersItems_20241016,AEB_CETagItems_20241017')
  .split(',').map((s) => s.trim()).filter(Boolean);

// isConfigured() only checks app creds exist (sync). Whether we actually have an
// OAuth token is resolved at call time -> no token = throw = mock fallback.
export function isConfigured() {
  return oauthConfigured();
}

// Pull product detail array out of the DS recommend-feed envelope (same nested
// {products:{product:[...]}} shape as the affiliate API).
function extractProducts(data) {
  if (!data) return [];
  if (data.error_response) {
    throw new Error(`AliExpress DS API error: ${data.error_response.msg || data.error_response.code || 'unknown'}`);
  }
  const result =
    data.aliexpress_ds_recommend_feed_get_response?.result ||              // DS feed shape
    data.aliexpress_ds_recommend_feed_get_response?.resp_result?.result ||
    data.resp_result?.result || {};
  let products = result.products;
  // DS feeds nest the array under traffic_product_d_t_o; affiliate uses product.
  if (products) products = products.traffic_product_d_t_o || products.product || products;
  return Array.isArray(products) ? products : [];
}

// Normalize a DS/affiliate product to the supplier shape finalizeMock expects.
function normalize(p) {
  const price = Number(p.target_sale_price ?? p.target_app_sale_price ?? p.sale_price);
  if (!Number.isFinite(price) || price <= 0) return null;
  const id = p.product_id;
  return {
    name: p.product_title,
    supplierPrice: price,                                  // GBP (target_currency=GBP)
    cat: p.second_level_category_name || p.first_level_category_name || 'AliExpress',
    vol: p.lastest_volume || '—',
    image: p.product_main_image_url || null,
    supplierUrl: p.promotion_link || p.product_detail_url || (id ? `https://www.aliexpress.com/item/${id}.html` : null),
    productId: id || null,
    _sales: Number(p.lastest_volume) || 0,
    _kw: `${p.product_title || ''} ${p.first_level_category_name || ''} ${p.second_level_category_name || ''}`.toLowerCase(),
  };
}

async function fetchFeed(feedName, accessToken, pageSize) {
  const data = await callSigned('aliexpress.ds.recommend.feed.get', {
    feed_name: feedName,
    target_currency: 'GBP',
    target_language: 'EN',
    country: 'UK',
    page_no: '1',
    page_size: String(Math.min(Math.max(pageSize, 1), 50)),
  }, { accessToken });
  return extractProducts(data);
}

// Fetch supplier-side products. Pulls the configured feeds, dedupes, then
// keyword-filters client-side (DS has no text search). Empty query -> trending.
// Returns [] / throws on no-token so research.js falls back to mock.
export async function fetchSupplierProducts(query, { limit = 20 } = {}) {
  const accessToken = await getValidAccessToken();
  if (!accessToken) throw new Error('AliExpress not connected (no OAuth token)');

  const q = (query || '').toLowerCase().trim();
  const perFeed = Math.max(limit, 20);

  // Pull a few feeds in parallel, tolerate individual feed failures.
  const results = await Promise.allSettled(DEFAULT_FEEDS.map((f) => fetchFeed(f, accessToken, perFeed)));
  const raw = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  if (!raw.length) {
    // surface the first feed error so research.js logs it before mock fallback
    const firstErr = results.find((r) => r.status === 'rejected');
    if (firstErr) throw firstErr.reason;
    return [];
  }

  // Normalize + dedupe by productId.
  const seen = new Set();
  let products = [];
  for (const p of raw) {
    const n = normalize(p);
    if (!n) continue;
    const key = n.productId || n.name;
    if (seen.has(key)) continue;
    seen.add(key);
    products.push(n);
  }

  // Keyword filter (DS has no server-side text search). Empty query -> trending.
  if (q && q !== 'all') {
    const terms = q.split(/\s+/).filter(Boolean);
    const matched = products.filter((p) => terms.every((t) => p._kw.includes(t)));
    if (matched.length) products = matched; // else keep the trending set (demo-friendly)
  }

  return products
    .sort((a, b) => b._sales - a._sales)
    .slice(0, limit);
}
