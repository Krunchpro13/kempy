// src/services/providers/tiktok.js
//
// Live TikTok-trending supply-side feed via EchoTik's TikTok Shop Data API
// (https://opendoc.echotik.live). There is NO official TikTok "trending products"
// API, so this uses EchoTik — a paid third-party data provider that exposes a
// real REST API. Returns trending TikTok Shop products which research.js then
// prices against eBay.co.uk (providers/enrich.js) to compute profit/ROI.
//
// Auth + config (set in Railway once you have an EchoTik plan with API access):
//   TIKTOK_API_KEY        — your EchoTik API token (sent as ?token=… )  [required]
//   TIKTOK_REGION         — market filter, default 'GB' (UK)
//   TIKTOK_API_URL        — override the product-list endpoint (default below)
//   TIKTOK_PRICE_GBP_RATE — EchoTik prices are USD; multiply by this to get GBP
//                           (default 0.79). Set to 1 if your plan returns GBP.
//
// Until TIKTOK_API_KEY is set, isConfigured() is false and research.js uses the
// mock feed. EchoTik's exact response field names can vary by plan — the
// normalizer below is defensive (tries several known field names); if a real
// response differs, adjust `pick()` calls here (no other file changes needed).

import axios from 'axios';

const DEFAULT_URL = 'https://open.echotik.live/api/v2/product/list';

export function isConfigured() {
  return !!process.env.TIKTOK_API_KEY;
}

// First defined value among several candidate field names.
function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj && obj[k] != null && obj[k] !== '') return obj[k];
  }
  return undefined;
}

// EchoTik wraps results differently across endpoints/plans — find the array.
function extractList(data) {
  if (Array.isArray(data)) return data;
  const d = data?.data ?? data;
  return d?.list || d?.items || d?.products || (Array.isArray(d) ? d : []);
}

function normalize(p, rate) {
  const name = pick(p, 'product_name', 'title', 'product_title', 'spu_name', 'name');
  if (!name) return null;
  const rawPrice = Number(pick(p, 'spu_avg_price', 'avg_price', 'price', 'sale_price', 'min_price'));
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) return null;
  const vol = Number(pick(p, 'total_sale_cnt', 'sale_cnt', 'sold_count', 'sales')) || '—';
  return {
    name,
    supplierPrice: Math.round(rawPrice * rate * 100) / 100,   // USD→GBP (or ×1)
    cat: pick(p, 'category_name', 'category', 'category_l2_name') || 'TikTok Trending',
    vol,
    image: pick(p, 'cover_url', 'image', 'image_url', 'product_image', 'cover') || null,
    supplierUrl: pick(p, 'product_url', 'detail_url', 'url') || null,
    productId: pick(p, 'product_id', 'spu_id', 'id') || null,
  };
}

// Fetch trending TikTok Shop products. Returns [] on error so research.js
// falls back to mock cleanly.
export async function fetchSupplierProducts(query, { limit = 20 } = {}) {
  const url = process.env.TIKTOK_API_URL || DEFAULT_URL;
  const rate = Number(process.env.TIKTOK_PRICE_GBP_RATE) || 0.79;
  const params = {
    token: process.env.TIKTOK_API_KEY,
    region: process.env.TIKTOK_REGION || 'GB',
    page_num: 1,
    page_size: Math.min(Math.max(limit, 1), 50),
    sort: 'total_sale_cnt_desc',                              // most-sold first
  };
  const q = (query || '').trim();
  if (q) params.keyword = q;

  const res = await axios.get(url, { params, timeout: 12000 });
  if (res.data && res.data.code != null && res.data.code !== 0 && res.data.code !== 200) {
    throw new Error(`EchoTik API error: ${res.data.message || res.data.code}`);
  }
  return extractList(res.data).map((p) => normalize(p, rate)).filter(Boolean);
}
