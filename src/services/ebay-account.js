// src/services/ebay-account.js
//
// One-time, idempotent eBay account setup needed before KEMPY can PUBLISH a
// live listing for a user:
//   1. opt into the Business Policies program (SELLING_POLICY_MANAGEMENT)
//   2. create a merchant location (needs the seller's country + postal code)
//   3. create default fulfillment / payment / return business policies
// All steps reuse existing eBay objects when present (look up by name/key) so
// re-running setup never creates duplicates. Policy/location IDs are cached in
// the ebay_seller_prefs table.
//
// Account API docs: https://developer.ebay.com/api-docs/sell/account/overview.html

import axios from 'axios';
import { query } from './db.js';
import { getValidAccessToken } from './ebay-oauth.js';

const ACCOUNT = 'https://api.ebay.com/sell/account/v1';
const INVENTORY = 'https://api.ebay.com/sell/inventory/v1';
const LOCATION_KEY = 'kempy-default';
const POLICY_NAME = 'KEMPY Default';

function marketplace() {
  return process.env.EBAY_MARKETPLACE_ID || 'EBAY_US';
}
function currency() {
  const m = marketplace();
  if (m === 'EBAY_GB') return 'GBP';
  if (m === 'EBAY_AU') return 'AUD';
  if (m === 'EBAY_CA') return 'CAD';
  if (['EBAY_DE', 'EBAY_FR', 'EBAY_IT', 'EBAY_ES'].includes(m)) return 'EUR';
  return 'USD';
}
function jsonHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'X-EBAY-C-MARKETPLACE-ID': marketplace(),
    'Content-Type': 'application/json',
    'Content-Language': 'en-US',
    Accept: 'application/json',
  };
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- structured error so routes/UI can show which step failed + eBay's reason ----
export class EbayStepError extends Error {
  constructor(step, detail, ebayErrors) {
    super(`ebay_${step}_failed`);
    this.code = 'ebay_step_failed';
    this.step = step;
    this.detail = detail;
    this.ebayErrors = ebayErrors || null;
  }
}
export function ebayDetail(err) {
  const errs = err?.response?.data?.errors;
  if (Array.isArray(errs) && errs.length) {
    return errs
      .map((e) => {
        const params = e.parameters ? ` (${e.parameters.map((p) => p.value).join(', ')})` : '';
        return (e.message || e.longMessage || 'error') + params;
      })
      .join('; ');
  }
  return err?.response?.data?.error_description || err?.message || 'unknown error';
}
function looksLikeOptInError(err) {
  return /opt|program|policy management/i.test(ebayDetail(err));
}

// ---- prefs row helpers ----
async function ensureRow(userId) {
  await query(
    `INSERT INTO ebay_seller_prefs (user_id, marketplace_id) VALUES ($1, $2)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, marketplace()],
  );
}
export async function getPrefs(userId) {
  const { rows } = await query(`SELECT * FROM ebay_seller_prefs WHERE user_id = $1`, [userId]);
  return rows[0] || null;
}
async function setPref(userId, col, value) {
  await ensureRow(userId);
  await query(
    `UPDATE ebay_seller_prefs SET ${col} = $1, updated_at = now() WHERE user_id = $2`,
    [value, userId],
  );
}

// ---- setup status (read-only) ----
export async function getSetupStatus(userId) {
  const prefs = await getPrefs(userId);
  const hasAddress = !!(prefs && prefs.country && prefs.postal_code);
  const missing = [];
  if (!hasAddress) missing.push('address');
  if (!prefs?.merchant_location_key) missing.push('location');
  if (!prefs?.fulfillment_policy_id) missing.push('fulfillment_policy');
  if (!prefs?.payment_policy_id) missing.push('payment_policy');
  if (!prefs?.return_policy_id) missing.push('return_policy');
  return { ready: missing.length === 0, hasAddress, missing, prefs: prefs || null, marketplace: marketplace() };
}

export async function saveSellerAddress(userId, { country, postalCode, addressLine1, city, stateOrProvince }) {
  await ensureRow(userId);
  await query(
    `UPDATE ebay_seller_prefs
        SET country = $1, postal_code = $2, address_line1 = $3, city = $4, state_or_province = $5, updated_at = now()
      WHERE user_id = $6`,
    [
      (country || 'US').toUpperCase(),
      postalCode || null,
      addressLine1 || null,
      city || null,
      stateOrProvince || null,
      userId,
    ],
  );
}

// ---- step 1: business-policies program opt-in ----
export async function ensureProgramOptIn(userId, token) {
  try {
    const { data } = await axios.get(`${ACCOUNT}/program/get_opted_in_programs`, {
      headers: jsonHeaders(token),
      timeout: 12_000,
    });
    const programs = (data.programs || []).map((p) => p.programType);
    if (!programs.includes('SELLING_POLICY_MANAGEMENT')) {
      await axios.post(
        `${ACCOUNT}/program/opt_in`,
        { programType: 'SELLING_POLICY_MANAGEMENT' },
        { headers: jsonHeaders(token), timeout: 12_000 },
      );
    }
    await setPref(userId, 'programs_opted_in', true);
  } catch (err) {
    throw new EbayStepError('programs', ebayDetail(err), err?.response?.data?.errors);
  }
}

// ---- step 2: merchant location ----
export async function ensureMerchantLocation(userId, token) {
  const prefs = await getPrefs(userId);
  if (!prefs?.country || !prefs?.postal_code) {
    throw new EbayStepError('location', 'Seller address (country + postal code) is required.');
  }
  try {
    // Reuse if our default key already exists.
    const { data } = await axios.get(`${INVENTORY}/location`, { headers: jsonHeaders(token), timeout: 12_000 });
    const existing = (data.locations || []).find((l) => l.merchantLocationKey === LOCATION_KEY);
    if (!existing) {
      await axios.post(
        `${INVENTORY}/location/${LOCATION_KEY}`,
        {
          location: {
            address: {
              country: prefs.country,
              postalCode: prefs.postal_code,
              ...(prefs.address_line1 ? { addressLine1: prefs.address_line1 } : {}),
              ...(prefs.city ? { city: prefs.city } : {}),
              ...(prefs.state_or_province ? { stateOrProvince: prefs.state_or_province } : {}),
            },
          },
          name: 'KEMPY Default',
          merchantLocationStatus: 'ENABLED',
          locationTypes: ['WAREHOUSE'],
        },
        { headers: jsonHeaders(token), timeout: 12_000 },
      );
    }
    await setPref(userId, 'merchant_location_key', LOCATION_KEY);
    return LOCATION_KEY;
  } catch (err) {
    throw new EbayStepError('location', ebayDetail(err), err?.response?.data?.errors);
  }
}

// ---- step 3: business policies (create-or-reuse by name) ----
async function ensurePolicy(userId, token, { step, listUrl, listKey, idKey, createUrl, body, prefCol }) {
  try {
    const { data } = await axios.get(`${listUrl}?marketplace_id=${marketplace()}`, {
      headers: jsonHeaders(token),
      timeout: 12_000,
    });
    const existing = (data[listKey] || []).find((p) => p.name === POLICY_NAME);
    let id = existing ? existing[idKey] : null;
    if (!id) {
      const res = await axios.post(createUrl, body, { headers: jsonHeaders(token), timeout: 12_000 });
      id = res.data[idKey];
    }
    await setPref(userId, prefCol, id);
    return id;
  } catch (err) {
    // opt-in may not have propagated yet — retry once.
    if (looksLikeOptInError(err)) {
      await delay(1500);
      try {
        const res = await axios.post(createUrl, body, { headers: jsonHeaders(token), timeout: 12_000 });
        const id = res.data[idKey];
        await setPref(userId, prefCol, id);
        return id;
      } catch (err2) {
        throw new EbayStepError(step, ebayDetail(err2), err2?.response?.data?.errors);
      }
    }
    throw new EbayStepError(step, ebayDetail(err), err?.response?.data?.errors);
  }
}

export function ensureFulfillmentPolicy(userId, token) {
  return ensurePolicy(userId, token, {
    step: 'fulfillment',
    listUrl: `${ACCOUNT}/fulfillment_policy`,
    listKey: 'fulfillmentPolicies',
    idKey: 'fulfillmentPolicyId',
    createUrl: `${ACCOUNT}/fulfillment_policy`,
    prefCol: 'fulfillment_policy_id',
    body: {
      name: POLICY_NAME,
      marketplaceId: marketplace(),
      categoryTypes: [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES' }],
      handlingTime: { value: 2, unit: 'DAY' },
      shippingOptions: [
        {
          optionType: 'DOMESTIC',
          costType: 'FLAT_RATE',
          shippingServices: [
            { sortOrder: 1, shippingServiceCode: 'USPSGroundAdvantage', freeShipping: true },
          ],
        },
      ],
    },
  });
}

export function ensurePaymentPolicy(userId, token) {
  return ensurePolicy(userId, token, {
    step: 'payment',
    listUrl: `${ACCOUNT}/payment_policy`,
    listKey: 'paymentPolicies',
    idKey: 'paymentPolicyId',
    createUrl: `${ACCOUNT}/payment_policy`,
    prefCol: 'payment_policy_id',
    body: {
      name: POLICY_NAME,
      marketplaceId: marketplace(),
      categoryTypes: [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES' }],
      immediatePay: true,
    },
  });
}

export function ensureReturnPolicy(userId, token) {
  return ensurePolicy(userId, token, {
    step: 'return',
    listUrl: `${ACCOUNT}/return_policy`,
    listKey: 'returnPolicies',
    idKey: 'returnPolicyId',
    createUrl: `${ACCOUNT}/return_policy`,
    prefCol: 'return_policy_id',
    body: {
      name: POLICY_NAME,
      marketplaceId: marketplace(),
      categoryTypes: [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES' }],
      returnsAccepted: true,
      returnPeriod: { value: 30, unit: 'DAY' },
      refundMethod: 'MONEY_BACK',
      returnShippingCostPayer: 'BUYER',
    },
  });
}

// ---- orchestrator ----
export async function runFullSetup(userId) {
  const token = await getValidAccessToken(userId);
  if (!token) throw new EbayStepError('auth', 'eBay not connected.');
  try {
    await ensureProgramOptIn(userId, token);
    await ensureMerchantLocation(userId, token);
    await ensureFulfillmentPolicy(userId, token);
    await ensurePaymentPolicy(userId, token);
    await ensureReturnPolicy(userId, token);
    await query(
      `UPDATE ebay_seller_prefs SET setup_completed_at = now(), last_error = NULL, updated_at = now() WHERE user_id = $1`,
      [userId],
    );
    return await getSetupStatus(userId);
  } catch (err) {
    const detail = err instanceof EbayStepError ? err.detail : ebayDetail(err);
    await query(
      `UPDATE ebay_seller_prefs SET last_error = $1, updated_at = now() WHERE user_id = $2`,
      [String(detail).slice(0, 300), userId],
    ).catch(() => {});
    throw err;
  }
}

export { currency, marketplace, LOCATION_KEY };
