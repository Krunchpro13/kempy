// src/services/providers/tiktok.js
//
// Live TikTok-trending supply-side feed via EchoTik's TikTok Shop Data API
// (https://opendoc.echotik.live). There is NO official TikTok "trending products"
// API, so this uses EchoTik — a paid third-party data provider with a real REST
// API. Returns trending TikTok Shop products which research.js then prices
// against eBay.co.uk (providers/enrich.js) to compute profit/ROI.
//
// Auth: HTTP Basic Auth, API key as the username (empty password) — verified
// against the live API 2026-06-07. Endpoint: /api/v2/product/list.
//
// Config (set in Railway once you have an EchoTik plan with API access):
//   TIKTOK_API_KEY        — your EchoTik API key (Basic-auth username)  [required]
//   TIKTOK_REGION         — market filter, default 'GB' (UK). Prices come back
//                           in the region's currency (GB → GBP), so no FX by default.
//   TIKTOK_PRICE_GBP_RATE — multiply prices by this (default 1; set if a non-GBP
//                           region is used and you want conversion).
//   TIKTOK_API_URL        — override the product-list endpoint (default below).
//
// Until TIKTOK_API_KEY is set, isConfigured() is false and research.js uses the
// mock feed.

import axios from 'axios';

const DEFAULT_URL = 'https://open.echotik.live/api/v2/product/list';

export function isConfigured() {
  return !!process.env.TIKTOK_API_KEY;
}

function authHeader() {
  // EchoTik Basic Auth: API key as username, empty password.
  return 'Basic ' + Buffer.from(`${process.env.TIKTOK_API_KEY}:`).toString('base64');
}

// cover_url arrives as a JSON-array-encoded STRING: '[{"url":"https://..."}]'
// (or '[]' when empty). Parse it and return the first image URL.
function firstImage(cover) {
  if (!cover) return null;
  try {
    const arr = typeof cover === 'string' ? JSON.parse(cover) : cover;
    if (Array.isArray(arr) && arr.length) return arr[0]?.url || (typeof arr[0] === 'string' ? arr[0] : null);
  } catch {
    if (typeof cover === 'string' && cover.startsWith('http')) return cover;
  }
  return null;
}

function normalize(p, rate) {
  const name = p.product_name || p.title || p.spu_name;
  if (!name) return null;
  const price = Number(p.spu_avg_price ?? p.min_price ?? p.max_price);
  if (!Number.isFinite(price) || price <= 0) return null;
  return {
    name,
    supplierPrice: Math.round(price * rate * 100) / 100,    // GB region → GBP (rate 1)
    cat: 'TikTok Trending',                                 // API gives category_id only, no name
    vol: Number(p.total_sale_cnt) || '—',
    image: firstImage(p.cover_url),
    supplierUrl: null,                                      // API has no product URL → search fallback
    productId: p.product_id || null,
    _sales: Number(p.total_sale_cnt) || 0,                  // for client-side ranking
  };
}

const PAGE_SIZE = 10;          // EchoTik hard cap is 10 per page
const MAX_PAGES = 3;           // up to 30 candidates, then rank client-side

async function fetchPage(url, baseParams, pageNum) {
  const res = await axios.get(url, {
    params: { ...baseParams, page_num: pageNum, page_size: PAGE_SIZE },
    headers: { Authorization: authHeader() },
    timeout: 15000,
  });
  if (res.data && res.data.code != null && res.data.code !== 0 && res.data.code !== 200) {
    throw new Error(`EchoTik API error: ${res.data.message || res.data.code}`);
  }
  const d = res.data?.data ?? res.data;
  return d?.list || d?.items || d?.products || (Array.isArray(d) ? d : []);
}

// Fetch trending TikTok Shop products. No keyword → hot/trending list; with a
// keyword → matching products. EchoTik's server-side sort params are unreliable
// (an invalid sort 500s) and page_size caps at 10, so we page then rank
// client-side by sales. Returns [] on error.
export async function fetchSupplierProducts(query, { limit = 20 } = {}) {
  const url = process.env.TIKTOK_API_URL || DEFAULT_URL;
  const rate = Number(process.env.TIKTOK_PRICE_GBP_RATE) || 1;
  const q = (query || '').trim();
  const baseParams = { region: process.env.TIKTOK_REGION || 'GB' };
  if (q) baseParams.keyword = q;
  else baseParams.is_hot = 1;                               // trending when no query

  const pages = Math.min(Math.ceil(limit / PAGE_SIZE) + 1, MAX_PAGES);
  const raw = [];
  for (let pg = 1; pg <= pages; pg++) {
    const list = await fetchPage(url, baseParams, pg);
    raw.push(...list);
    if (list.length < PAGE_SIZE) break;                     // last page
  }
  return raw
    .map((p) => normalize(p, rate))
    .filter(Boolean)
    .sort((a, b) => b._sales - a._sales)                    // most-sold first
    .slice(0, limit);
}
