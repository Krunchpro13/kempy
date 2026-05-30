// src/services/ebay-seller.js
//
// Reads a connected seller's real eBay data and maps it into the exact shapes
// the frontend pages (listings / orders / profit) already render.
//
// Every function resolves a fresh access token via ebay-oauth.getValidAccessToken:
//   - returns null  -> the user hasn't connected eBay (route shows "Connect" CTA)
//   - returns []     -> connected but no data yet (route shows empty state)
//   - throws ebay_refresh_failed -> token died (route shows "reconnect" prompt)
//
// APIs used:
//   Orders    GET /sell/fulfillment/v1/order
//   Listings  GET /sell/inventory/v1/inventory_item
//   Fees      GET /sell/finances/v1/transaction   (real eBay final-value fees)

import axios from 'axios';
import { getValidAccessToken } from './ebay-oauth.js';
import { ECONOMICS } from '../config.js';

const FULFILLMENT = 'https://api.ebay.com/sell/fulfillment/v1/order';
const INVENTORY   = 'https://api.ebay.com/sell/inventory/v1/inventory_item';
const FINANCES    = 'https://api.ebay.com/sell/finances/v1/transaction';

function marketplace() {
  return process.env.EBAY_MARKETPLACE_ID || 'EBAY_US';
}

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    'X-EBAY-C-MARKETPLACE-ID': marketplace(),
    Accept: 'application/json',
  };
}

// ============================================================================
// Orders
// ============================================================================
export async function getOrders(userId, { limit = 50 } = {}) {
  const token = await getValidAccessToken(userId);
  if (!token) return null;

  const { data } = await axios.get(FULFILLMENT, {
    headers: headers(token),
    params: { limit },
    timeout: 12_000,
  });

  const orders = (data && data.orders) || [];
  const feeMap = await getFinancesFeeMap(userId, token);
  return orders.map(o => mapOrder(o, feeMap));
}

function mapOrder(o, feeMap) {
  const sale = num(o.pricingSummary?.total?.value);
  const fees = feeMap[o.orderId] != null
    ? round2(feeMap[o.orderId])
    : round2(sale * ECONOMICS.EBAY_FEE_RATE);
  const li = (o.lineItems && o.lineItems[0]) || {};
  const ship = o.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
  const addr = ship?.contactAddress || {};
  const costPrice = 0; // supplier cost unknown from eBay — see profit COGS note

  return {
    id: o.orderId,
    item: li.title || '(item)',
    channel: 'ebay',
    status: mapOrderStatus(o),
    salePrice: sale,
    costPrice,
    fees,
    profit: round2(sale - fees - costPrice),
    customer: ship?.fullName || o.buyer?.username || '—',
    location: [addr.city, addr.stateOrProvince].filter(Boolean).join(', ') || '—',
    placedAt: o.creationDate || null,
    tracking: extractTracking(o),
  };
}

// eBay has 3 fulfillment states; the UI has 4 (new/ordered/shipped/delivered).
// "ordered" means we bought from Amazon — no eBay equivalent, so never emitted.
function mapOrderStatus(o) {
  const f = o.orderFulfillmentStatus;
  if (f === 'FULFILLED') return 'delivered';
  if (f === 'IN_PROGRESS') return 'shipped';
  return 'new';
}

function extractTracking() {
  // Tracking numbers require a separate /order/{id}/shipping_fulfillment call.
  // Deferred to v1.1 — null keeps the UI's "no tracking" state.
  return null;
}

// ============================================================================
// Listings (Inventory API)
// ============================================================================
export async function getListings(userId, { limit = 100 } = {}) {
  const token = await getValidAccessToken(userId);
  if (!token) return null;

  const { data } = await axios.get(INVENTORY, {
    headers: headers(token),
    params: { limit },
    timeout: 12_000,
  });
  // NOTE: only inventory-API-managed items appear here. Listings created in the
  // eBay web UI need the legacy Trading API (v1.1). Empty account => low urgency.
  return ((data && data.inventoryItems) || []).map(mapInventoryItem);
}

function mapInventoryItem(it) {
  return {
    id: it.sku,
    name: it.product?.title || it.sku,
    img: it.product?.imageUrls?.[0] || null,
    sku: it.sku,
    channel: 'ebay',
    status: 'active',
    sellPrice: 0,   // price/views/watchers live on the Offer (v1.1 join)
    costPrice: 0,
    profit: 0,
    views: 0,
    watchers: 0,
    sold: 0,
    listedAt: null,
    url: null,
  };
}

// ============================================================================
// Finances — real fee per order
// ============================================================================
async function getFinancesFeeMap(userId, token) {
  try {
    const { data } = await axios.get(FINANCES, {
      headers: headers(token),
      params: { filter: 'transactionType:{SALE}', limit: 200 },
      timeout: 12_000,
    });
    const map = {};
    for (const t of (data.transactions || [])) {
      const id = t.orderId;
      if (!id) continue;
      const fee = num(t.totalFeeAmount?.value);
      map[id] = (map[id] || 0) + fee;
    }
    return map;
  } catch {
    return {}; // finances scope optional — fall back to estimated fees
  }
}

// ============================================================================
// Profit — aggregate orders into the profit page's shape
// ============================================================================
export async function getProfit(userId, period = 30) {
  const orders = await getOrders(userId, { limit: 200 });
  if (orders === null) return null;

  const days = [7, 30, 90, 365].includes(Number(period)) ? Number(period) : 30;
  const cutoff = Date.now() - days * 86_400_000;
  const inWindow = orders.filter(o => o.placedAt && new Date(o.placedAt).getTime() >= cutoff);

  const revenue = round2(inWindow.reduce((s, o) => s + o.salePrice, 0));
  const profit = round2(inWindow.reduce((s, o) => s + o.profit, 0));

  return {
    orders: inWindow.length,
    revenue,
    profit,
    series: buildSeries(inWindow, days),
    topProducts: buildTopProducts(inWindow),
    channels: buildChannels(inWindow),
    transactions: buildTransactions(inWindow),
  };
}

function buildSeries(orders, days) {
  // zero-fill every day so the chart x-axis is continuous
  const buckets = new Map();
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000);
    const key = isoDay(d);
    buckets.set(key, { date: key, label: shortLabel(d), revenue: 0, profit: 0 });
  }
  for (const o of orders) {
    const key = isoDay(new Date(o.placedAt));
    const b = buckets.get(key);
    if (b) {
      b.revenue = round2(b.revenue + o.salePrice);
      b.profit = round2(b.profit + o.profit);
    }
  }
  return [...buckets.values()];
}

function buildTopProducts(orders) {
  const byName = new Map();
  for (const o of orders) {
    const cur = byName.get(o.item) || { name: o.item, cat: '—', units: 0, profit: 0 };
    cur.units += 1;
    cur.profit = round2(cur.profit + o.profit);
    byName.set(o.item, cur);
  }
  return [...byName.values()].sort((a, b) => b.profit - a.profit).slice(0, 5);
}

function buildChannels(orders) {
  const revenue = orders.reduce((s, o) => s + o.salePrice, 0);
  if (revenue <= 0) return [];
  return [{ name: 'eBay', sub: '1 store', value: 100, color: '#e53238', cls: 'ebay' }];
}

function buildTransactions(orders) {
  return [...orders]
    .sort((a, b) => new Date(b.placedAt) - new Date(a.placedAt))
    .slice(0, 10)
    .map(o => ({ date: o.placedAt, item: o.item, id: o.id, gross: o.salePrice, net: o.profit }));
}

// ---------- helpers ----------
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
function isoDay(d) {
  return d.toISOString().slice(0, 10);
}
function shortLabel(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
