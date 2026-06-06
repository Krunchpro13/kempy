// src/services/providers/aliexpress.js
//
// Live AliExpress supply-side feed via the official AliExpress Open Platform
// Affiliate API (https://open.aliexpress.com). Returns trending / matching
// products with real GBP prices, which research.js then prices against
// eBay.co.uk (see providers/enrich.js) to compute profit/ROI.
//
// Auth: signed requests. You need an approved Open Platform app:
//   ALIEXPRESS_APP_KEY      — your app key
//   ALIEXPRESS_APP_SECRET   — your app secret (used to HMAC-sign requests; secret)
//   ALIEXPRESS_TRACKING_ID  — your affiliate tracking id
//   ALIEXPRESS_SESSION      — (optional) access token, only if your app requires it
//
// Until those are set, isConfigured() is false and research.js uses the mock feed.
//
// Signing (mirrors AliExpress' "TOP" gateway scheme):
//   basestring = concat of (key + value) for every request param, sorted by key.
//   sign = HMAC-SHA256(app_secret, basestring) as UPPERCASE hex.
// Reference: github.com/moh3a/ae_sdk (utils/client.ts) + open.aliexpress.com docs.

import crypto from 'crypto';
import axios from 'axios';

const GATEWAY = 'https://api-sg.aliexpress.com/sync';
const SIGN_METHOD = 'sha256';
const METHOD_QUERY = 'aliexpress.affiliate.product.query';     // keyword search
const METHOD_HOT = 'aliexpress.affiliate.hotproduct.query';    // trending (no keyword)

export function isConfigured() {
  return !!(process.env.ALIEXPRESS_APP_KEY && process.env.ALIEXPRESS_APP_SECRET && process.env.ALIEXPRESS_TRACKING_ID);
}

// HMAC-SHA256 sign: sorted concat of key+value over all params, uppercase hex.
function sign(params, secret) {
  const basestring = Object.keys(params)
    .filter((k) => params[k] != null && params[k] !== '')
    .sort()
    .reduce((acc, k) => acc + k + String(params[k]), '');
  return crypto.createHmac(SIGN_METHOD, secret).update(basestring, 'utf8').digest('hex').toUpperCase();
}

async function call(method, extra) {
  const params = {
    app_key: process.env.ALIEXPRESS_APP_KEY,
    method,
    format: 'json',
    sign_method: SIGN_METHOD,
    timestamp: String(Date.now()),
    v: '2.0',
    tracking_id: process.env.ALIEXPRESS_TRACKING_ID,
    target_currency: 'GBP',
    target_language: 'EN',
    ship_to_country: 'UK',
    ...extra,
  };
  if (process.env.ALIEXPRESS_SESSION) params.session = process.env.ALIEXPRESS_SESSION;
  params.sign = sign(params, process.env.ALIEXPRESS_APP_SECRET);

  const res = await axios.get(GATEWAY, { params, timeout: 12000 });
  return res.data;
}

// Dig the products array out of the (sometimes doubly-wrapped) affiliate response,
// tolerating both the query and hotproduct envelopes + the `products.product` nesting.
function extractProducts(data, method) {
  if (!data) return [];
  if (data.error_response) {
    throw new Error(`AliExpress API error: ${data.error_response.msg || data.error_response.code || 'unknown'}`);
  }
  const envKey =
    method === METHOD_HOT
      ? 'aliexpress_affiliate_hotproduct_query_response'
      : 'aliexpress_affiliate_product_query_response';
  const result = data[envKey]?.resp_result?.result || data.resp_result?.result || {};
  let products = result.products;
  if (products && products.product) products = products.product; // unwrap {product:[...]}
  return Array.isArray(products) ? products : [];
}

// Normalize one AliExpress product to the supplier shape finalizeMock expects.
function normalize(p) {
  const price = Number(p.target_sale_price ?? p.sale_price ?? p.target_app_sale_price);
  if (!Number.isFinite(price) || price <= 0) return null;
  return {
    name: p.product_title,
    supplierPrice: price,                                  // already GBP (target_currency)
    cat: p.second_level_category_name || p.first_level_category_name || 'AliExpress',
    vol: p.lastest_volume || '—',
    image: p.product_main_image_url || null,
    supplierUrl: p.promotion_link || p.product_detail_url || null,
    productId: p.product_id || null,
  };
}

// Fetch supplier-side products. With a query → keyword search; without → trending.
// Returns [] on any error so research.js can fall back to mock cleanly.
export async function fetchSupplierProducts(query, { limit = 20 } = {}) {
  const q = (query || '').trim();
  const method = q ? METHOD_QUERY : METHOD_HOT;
  const extra = {
    page_no: '1',
    page_size: String(Math.min(Math.max(limit, 1), 50)),
    sort: 'LAST_VOLUME_DESC',                              // most-sold first
  };
  if (q) extra.keywords = q;

  const data = await call(method, extra);
  return extractProducts(data, method).map(normalize).filter(Boolean);
}
