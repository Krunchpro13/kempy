// src/services/ebay-listing.js
//
// Turns a KEMPY product into a LIVE eBay fixed-price listing via the Inventory API:
//   resolve leaf category (Taxonomy) → PUT inventory_item → POST offer → publish.
// Account prerequisites (policies, location) are handled by ebay-account.js and
// must be ready first. Reuses getValidAccessToken + the shared EbayStepError model.
//
// Inventory API: https://developer.ebay.com/api-docs/sell/inventory/overview.html

import axios from 'axios';
import crypto from 'crypto';
import { query } from './db.js';
import { getValidAccessToken } from './ebay-oauth.js';
import {
  EbayStepError,
  ebayDetail,
  getSetupStatus,
  currency,
  marketplace,
  LOCATION_KEY,
} from './ebay-account.js';

const INVENTORY = 'https://api.ebay.com/sell/inventory/v1';
const TAXONOMY = 'https://api.ebay.com/commerce/taxonomy/v1';

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    'X-EBAY-C-MARKETPLACE-ID': marketplace(),
    'Content-Type': 'application/json',
    'Content-Language': 'en-US',
    Accept: 'application/json',
  };
}

// ---- SKU ----
export function buildSku(product) {
  let base;
  if (product?.asin) base = 'kempy-' + product.asin;
  else if (product?.ebayItemId) base = 'kempy-e' + product.ebayItemId;
  else base = 'kempy-r' + crypto.randomBytes(4).toString('hex');
  return base.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 50);
}

// ---- condition string → eBay enum ----
const CONDITION_MAP = {
  'new': 'NEW',
  'brand new': 'NEW',
  'new with tags': 'NEW_WITH_TAGS',
  'new without tags': 'NEW_WITHOUT_TAGS',
  'new other': 'NEW_OTHER',
  'open box': 'NEW_OTHER',
  'certified - refurbished': 'CERTIFIED_REFURBISHED',
  'certified refurbished': 'CERTIFIED_REFURBISHED',
  'seller refurbished': 'SELLER_REFURBISHED',
  'used': 'USED_EXCELLENT',
  'pre-owned': 'USED_EXCELLENT',
  'very good': 'USED_VERY_GOOD',
  'good': 'USED_GOOD',
  'acceptable': 'USED_ACCEPTABLE',
  'for parts or not working': 'FOR_PARTS_OR_NOT_WORKING',
};
export function mapCondition(str) {
  if (!str) return 'NEW';
  // already an enum?
  if (/^[A-Z_]+$/.test(str)) return str;
  return CONDITION_MAP[String(str).trim().toLowerCase()] || 'NEW';
}

// ---- category (Taxonomy) ----
export async function getCategoryTreeId(userId, token) {
  const { rows } = await query(`SELECT category_tree_id FROM ebay_seller_prefs WHERE user_id = $1`, [userId]);
  if (rows[0]?.category_tree_id) return rows[0].category_tree_id;
  const { data } = await axios.get(`${TAXONOMY}/get_default_category_tree_id`, {
    headers: headers(token),
    params: { marketplace_id: marketplace() },
    timeout: 12_000,
  });
  const treeId = data.categoryTreeId;
  await query(`UPDATE ebay_seller_prefs SET category_tree_id = $1, updated_at = now() WHERE user_id = $2`, [treeId, userId]).catch(() => {});
  return treeId;
}

export async function suggestLeafCategory(userId, token, title) {
  const treeId = await getCategoryTreeId(userId, token);
  const { data } = await axios.get(`${TAXONOMY}/category_tree/${treeId}/get_category_suggestions`, {
    headers: headers(token),
    params: { q: (title || '').slice(0, 100) },
    timeout: 12_000,
  });
  const first = (data.categorySuggestions || [])[0];
  if (!first?.category?.categoryId) {
    throw new EbayStepError('category', 'eBay could not suggest a category for this title.');
  }
  return { categoryId: first.category.categoryId, categoryName: first.category.categoryName };
}

// ---- inventory item ----
export async function putInventoryItem(token, sku, { title, description, imageUrls, condition, quantity, aspects }) {
  const body = {
    availability: { shipToLocationAvailability: { quantity: quantity || 1 } },
    condition: condition || 'NEW',
    product: {
      title: (title || '').slice(0, 80),
      description: description || title || '',
      aspects: aspects || { Brand: ['Unbranded'] },
      ...(imageUrls && imageUrls.length ? { imageUrls } : {}),
    },
  };
  await axios.put(`${INVENTORY}/inventory_item/${sku}`, body, { headers: headers(token), timeout: 15_000 });
}

// ---- offer (create-or-reuse by SKU) ----
export async function ensureOffer(token, { sku, categoryId, price, quantity, description, policies, merchantLocationKey }) {
  // Reuse an existing offer for this SKU if present (idempotent re-list).
  try {
    const { data } = await axios.get(`${INVENTORY}/offer`, {
      headers: headers(token),
      params: { sku },
      timeout: 12_000,
    });
    const existing = (data.offers || [])[0];
    if (existing?.offerId) return existing.offerId;
  } catch (_) {
    /* no existing offer — fall through to create */
  }
  const body = {
    sku,
    marketplaceId: marketplace(),
    format: 'FIXED_PRICE',
    availableQuantity: quantity || 1,
    categoryId,
    listingDescription: description || '',
    pricingSummary: { price: { value: Number(price).toFixed(2), currency: currency() } },
    listingPolicies: {
      fulfillmentPolicyId: policies.fulfillmentPolicyId,
      paymentPolicyId: policies.paymentPolicyId,
      returnPolicyId: policies.returnPolicyId,
    },
    merchantLocationKey: merchantLocationKey || LOCATION_KEY,
  };
  const { data } = await axios.post(`${INVENTORY}/offer`, body, { headers: headers(token), timeout: 15_000 });
  return data.offerId;
}

export async function publishOffer(token, offerId) {
  const { data } = await axios.post(`${INVENTORY}/offer/${offerId}/publish`, {}, { headers: headers(token), timeout: 20_000 });
  return data.listingId;
}

function isImageError(err) {
  return /image|picture|photo|imageUrls/i.test(ebayDetail(err));
}

// ---- orchestrator ----
export async function publishProduct(userId, { product, title, price, quantity, condition, description }) {
  const token = await getValidAccessToken(userId);
  if (!token) throw new EbayStepError('auth', 'eBay not connected.');

  const setup = await getSetupStatus(userId);
  if (!setup.ready) {
    throw new EbayStepError('setup', 'eBay listing setup is incomplete: ' + setup.missing.join(', '));
  }
  const prefs = setup.prefs;
  const sku = buildSku(product);
  const finalTitle = (title || product.name || '').slice(0, 80);
  const finalPrice = price != null ? price : product.ebayPrice;
  const qty = quantity || 1;
  const condEnum = mapCondition(condition || product.condition);
  const desc = description || finalTitle;
  const imageUrls = product.image ? [product.image] : [];

  // upsert the tracking row (draft)
  await query(
    `INSERT INTO ebay_listings (user_id, sku, title, price, quantity, condition, asin, source_ebay_item_id, status, step)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft','start')
     ON CONFLICT (user_id, sku) DO UPDATE SET
       title=$3, price=$4, quantity=$5, condition=$6, status='draft', step='start', error=NULL, updated_at=now()`,
    [userId, sku, finalTitle, finalPrice, qty, condEnum, product.asin || null, product.ebayItemId || null],
  );

  const fail = async (step, detail, ebayErrors) => {
    await query(
      `UPDATE ebay_listings SET status='failed', step=$1, error=$2, updated_at=now() WHERE user_id=$3 AND sku=$4`,
      [step, String(detail).slice(0, 500), userId, sku],
    ).catch(() => {});
    throw new EbayStepError(step, detail, ebayErrors);
  };

  try {
    // category
    let categoryId;
    try {
      ({ categoryId } = await suggestLeafCategory(userId, token, finalTitle));
    } catch (err) {
      if (err instanceof EbayStepError) return fail(err.step, err.detail, err.ebayErrors);
      return fail('category', ebayDetail(err), err?.response?.data?.errors);
    }
    await query(`UPDATE ebay_listings SET category_id=$1, step='inventory', updated_at=now() WHERE user_id=$2 AND sku=$3`, [categoryId, userId, sku]);

    // inventory item (retry without images on image-specific failure)
    try {
      await putInventoryItem(token, sku, { title: finalTitle, description: desc, imageUrls, condition: condEnum, quantity: qty });
    } catch (err) {
      if (imageUrls.length && isImageError(err)) {
        await putInventoryItem(token, sku, { title: finalTitle, description: desc, imageUrls: [], condition: condEnum, quantity: qty });
      } else {
        return fail('inventory', ebayDetail(err), err?.response?.data?.errors);
      }
    }

    // offer
    let offerId;
    try {
      offerId = await ensureOffer(token, {
        sku,
        categoryId,
        price: finalPrice,
        quantity: qty,
        description: desc,
        policies: {
          fulfillmentPolicyId: prefs.fulfillment_policy_id,
          paymentPolicyId: prefs.payment_policy_id,
          returnPolicyId: prefs.return_policy_id,
        },
        merchantLocationKey: prefs.merchant_location_key,
      });
    } catch (err) {
      return fail('offer', ebayDetail(err), err?.response?.data?.errors);
    }
    await query(`UPDATE ebay_listings SET offer_id=$1, step='publish', updated_at=now() WHERE user_id=$2 AND sku=$3`, [offerId, userId, sku]);

    // publish
    let listingId;
    try {
      listingId = await publishOffer(token, offerId);
    } catch (err) {
      return fail('publish', ebayDetail(err), err?.response?.data?.errors);
    }

    await query(
      `UPDATE ebay_listings SET status='published', listing_id=$1, step='done', error=NULL, updated_at=now() WHERE user_id=$2 AND sku=$3`,
      [listingId, userId, sku],
    );
    return { ok: true, listingId, offerId, sku, url: `https://www.ebay.com/itm/${listingId}` };
  } catch (err) {
    if (err instanceof EbayStepError) throw err;
    return fail('unknown', ebayDetail(err), err?.response?.data?.errors);
  }
}
