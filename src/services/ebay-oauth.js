// src/services/ebay-oauth.js
//
// eBay SELLER OAuth (Authorization Code grant) — distinct from src/services/ebay.js,
// which uses the client-credentials (app token) grant for public Browse search.
//
// This flow lets a user connect their OWN eBay store so we can read their
// listings / orders / finances:
//   1. buildConsentUrl()  -> redirect the user to eBay to log in + consent
//   2. eBay redirects back to /api/ebay/callback with ?code=
//   3. exchangeCode()     -> swap the code for access + refresh tokens, store them
//   4. getValidAccessToken() -> hand callers a fresh token, auto-refreshing as needed
//
// The refresh token (~18mo) is encrypted at rest (see crypto.js). The access
// token (~2h) is cached in the row and refreshed on demand.
//
// Docs: https://developer.ebay.com/api-docs/static/oauth-authorization-code-grant.html

import axios from 'axios';
import { query } from './db.js';
import { encrypt, decrypt } from './crypto.js';

const TOKEN_URL   = 'https://api.ebay.com/identity/v1/oauth2/token';
const CONSENT_URL = 'https://auth.ebay.com/oauth2/authorize';

// Read-only Sell scopes: orders (fulfillment), listings (inventory), fees (finances).
const SCOPES = [
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.inventory.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.finances.readonly',
];

// eBay refresh tokens last ~18 months; default if the response omits the field.
const DEFAULT_REFRESH_TTL = 47_304_000; // seconds (~547 days)

export function isConfigured() {
  return !!(
    process.env.EBAY_CLIENT_ID &&
    process.env.EBAY_CLIENT_SECRET &&
    process.env.EBAY_RUNAME &&
    process.env.ENCRYPTION_KEY
  );
}

function marketplace() {
  return process.env.EBAY_MARKETPLACE_ID || 'EBAY_US';
}

function basicAuth() {
  const id = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;
  return Buffer.from(`${id}:${secret}`).toString('base64');
}

// ---------- step 1: consent URL ----------
export function buildConsentUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.EBAY_CLIENT_ID,
    redirect_uri: process.env.EBAY_RUNAME, // the RuName string, NOT the literal URL
    response_type: 'code',
    scope: SCOPES.join(' '),
    state,
  });
  return `${CONSENT_URL}?${params.toString()}`;
}

// ---------- step 3: exchange authorization code for tokens ----------
export async function exchangeCode(userId, code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: process.env.EBAY_RUNAME,
  });

  const { data } = await axios.post(TOKEN_URL, body, {
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    timeout: 10_000,
  });

  const now = Date.now();
  const accessExp = new Date(now + (data.expires_in || 7200) * 1000);
  const refreshExp = new Date(now + (data.refresh_token_expires_in || DEFAULT_REFRESH_TTL) * 1000);

  await query(
    `INSERT INTO ebay_connections
       (user_id, marketplace_id, scopes, access_token, access_token_expires_at,
        refresh_token_enc, refresh_token_expires_at, connected_at, updated_at, last_error)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now(), now(), NULL)
     ON CONFLICT (user_id) DO UPDATE SET
       marketplace_id = $2, scopes = $3, access_token = $4, access_token_expires_at = $5,
       refresh_token_enc = $6, refresh_token_expires_at = $7, updated_at = now(), last_error = NULL`,
    [
      userId,
      marketplace(),
      data.scope || SCOPES.join(' '),
      data.access_token,
      accessExp,
      encrypt(data.refresh_token),
      refreshExp,
    ],
  );
}

// ---------- step 4: return a valid access token, refreshing if needed ----------
export async function getValidAccessToken(userId) {
  const { rows } = await query(
    `SELECT access_token, access_token_expires_at, refresh_token_enc, scopes
       FROM ebay_connections WHERE user_id = $1`,
    [userId],
  );
  if (!rows.length) return null; // not connected

  const row = rows[0];
  const exp = row.access_token_expires_at ? new Date(row.access_token_expires_at).getTime() : 0;
  // Reuse the cached token if it has >60s of life left.
  if (row.access_token && Date.now() < exp - 60_000) return row.access_token;

  // Otherwise refresh.
  const refreshToken = decrypt(row.refresh_token_enc);
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: row.scopes || SCOPES.join(' '),
  });

  try {
    const { data } = await axios.post(TOKEN_URL, body, {
      headers: {
        Authorization: `Basic ${basicAuth()}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 10_000,
    });
    const accessExp = new Date(Date.now() + (data.expires_in || 7200) * 1000);
    await query(
      `UPDATE ebay_connections
          SET access_token = $1, access_token_expires_at = $2, updated_at = now(), last_error = NULL
        WHERE user_id = $3`,
      [data.access_token, accessExp, userId],
    );
    return data.access_token;
  } catch (err) {
    const msg = err.response?.data?.error_description || err.message || 'refresh failed';
    await query(
      `UPDATE ebay_connections SET last_error = $1, updated_at = now() WHERE user_id = $2`,
      [String(msg).slice(0, 300), userId],
    ).catch(() => {});
    const e = new Error('ebay_refresh_failed');
    e.code = 'ebay_refresh_failed';
    e.detail = msg;
    throw e;
  }
}

// ---------- status / disconnect ----------
export async function getConnection(userId) {
  const { rows } = await query(
    `SELECT ebay_user_id, marketplace_id, scopes, connected_at,
            refresh_token_expires_at, last_error
       FROM ebay_connections WHERE user_id = $1`,
    [userId],
  );
  return rows[0] || null;
}

export async function disconnect(userId) {
  await query(`DELETE FROM ebay_connections WHERE user_id = $1`, [userId]);
}

export { SCOPES };
