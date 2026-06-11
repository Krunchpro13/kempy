// src/services/providers/aliexpress-oauth.js
//
// AliExpress Open Platform OAuth (authorization-code grant) + signed-request
// helper for the Dropshipping (DS) API. This is APP-LEVEL: one shared token for
// KEMPY's own AliExpress sourcing account (stored as the single aliexpress_oauth
// row), NOT per-user.
//
// Flow:
//   1. buildAuthUrl()         -> owner visits, logs in, consents
//   2. AE redirects to /api/aliexpress/callback?code=
//   3. exchangeCode(code)     -> /rest/auth/token/create, store access+refresh
//   4. getValidAccessToken()  -> hand callers a fresh token, auto-refresh
//
// Signing is the AliExpress "TOP" scheme (HMAC-SHA256 over the sorted key+value
// concatenation; for the /rest system methods the method path is prepended to
// the base string). Refresh token encrypted at rest via crypto.js (ENCRYPTION_KEY).

import crypto from 'crypto';
import axios from 'axios';
import { query } from '../db.js';
import { encrypt, decrypt } from '../crypto.js';

const SYNC_GATEWAY = 'https://api-sg.aliexpress.com/sync';   // dotted business methods
const REST_GATEWAY = 'https://api-sg.aliexpress.com/rest';   // /auth/token/* system methods
const AUTH_URL = 'https://api-sg.aliexpress.com/oauth/authorize';
const SIGN_METHOD = 'sha256';

export function isConfigured() {
  return !!(process.env.ALIEXPRESS_APP_KEY && process.env.ALIEXPRESS_APP_SECRET && process.env.ENCRYPTION_KEY);
}

function redirectUri() {
  return process.env.ALIEXPRESS_REDIRECT_URI || `${process.env.APP_URL || 'https://kempzonline.com'}/api/aliexpress/callback`;
}

// HMAC-SHA256 sign over the params sorted by key as key+value pairs.
//   - dotted (sync) methods: `method` is a normal param, included in the sort
//     (this is the exact scheme verified against the live affiliate API).
//   - "/rest" system methods: the method path is PREPENDED to the base string
//     and the method is not itself a param.
function sign(params, method, secret) {
  const isRest = method.startsWith('/');
  const concat = Object.keys(params)
    .filter((k) => params[k] != null && params[k] !== '')
    .sort()
    .reduce((acc, k) => acc + k + String(params[k]), '');
  const base = isRest ? method + concat : concat;
  return crypto.createHmac(SIGN_METHOD, secret).update(base, 'utf8').digest('hex').toUpperCase();
}

// Low-level signed call. `method`:
//   - dotted (e.g. 'aliexpress.ds.recommend.feed.get') -> /sync gateway, method is a param
//   - path   (e.g. '/auth/token/create')               -> /rest gateway, method in the URL path
export async function callSigned(method, extra = {}, { accessToken } = {}) {
  const isRest = method.startsWith('/');
  const params = {
    app_key: process.env.ALIEXPRESS_APP_KEY,
    sign_method: SIGN_METHOD,
    timestamp: String(Date.now()),
    ...extra,
  };
  if (!isRest) params.method = method;           // sync methods carry `method` as a signed param
  if (accessToken) params.session = accessToken; // DS business calls need the session token
  // Sign over all params (method path handled inside sign()).
  params.sign = sign({ ...params }, method, process.env.ALIEXPRESS_APP_SECRET);

  const url = isRest ? `${REST_GATEWAY}${method}` : SYNC_GATEWAY;
  const res = await axios.get(url, { params, timeout: 15000 });
  return res.data;
}

// ---------- step 1: authorize URL ----------
export function buildAuthUrl(state) {
  const params = new URLSearchParams({
    response_type: 'code',
    force_auth: 'true',
    client_id: process.env.ALIEXPRESS_APP_KEY,
    redirect_uri: redirectUri(),
    state: state || '',
  });
  return `${AUTH_URL}?${params.toString()}`;
}

function persistToken(data) {
  const now = Date.now();
  // AE returns expires_in (ms in some versions, s in others) + absolute expire_time(ms).
  const accessExp = data.expire_time
    ? new Date(Number(data.expire_time))
    : new Date(now + (Number(data.expires_in) > 1e6 ? Number(data.expires_in) : Number(data.expires_in || 86400) * 1000));
  const refreshExp = data.refresh_token_valid_time
    ? new Date(Number(data.refresh_token_valid_time))
    : new Date(now + (Number(data.refresh_expires_in || 0) * 1000 || 30 * 24 * 3600 * 1000));
  return query(
    `INSERT INTO aliexpress_oauth
       (id, ae_user_id, access_token, access_token_expires_at, refresh_token_enc, refresh_token_expires_at, connected_at, updated_at, last_error)
     VALUES (1, $1, $2, $3, $4, $5, now(), now(), NULL)
     ON CONFLICT (id) DO UPDATE SET
       ae_user_id = $1, access_token = $2, access_token_expires_at = $3,
       refresh_token_enc = $4, refresh_token_expires_at = $5, updated_at = now(), last_error = NULL`,
    [
      data.user_id || data.account_id || null,
      data.access_token,
      accessExp,
      data.refresh_token ? encrypt(data.refresh_token) : null,
      refreshExp,
    ],
  );
}

// ---------- step 3: exchange code for tokens ----------
export async function exchangeCode(code) {
  const data = await callSigned('/auth/token/create', { code });
  if (!data.access_token) {
    throw new Error(`token exchange failed: ${JSON.stringify(data).slice(0, 300)}`);
  }
  await persistToken(data);
  return { aeUserId: data.user_id || null };
}

// ---------- step 4: valid access token (auto-refresh) ----------
export async function getValidAccessToken() {
  const { rows } = await query(
    `SELECT access_token, access_token_expires_at, refresh_token_enc FROM aliexpress_oauth WHERE id = 1`,
  );
  if (!rows.length) return null; // not connected
  const row = rows[0];
  const exp = row.access_token_expires_at ? new Date(row.access_token_expires_at).getTime() : 0;
  if (row.access_token && Date.now() < exp - 60_000) return row.access_token;
  if (!row.refresh_token_enc) return row.access_token || null;

  // Refresh.
  try {
    const data = await callSigned('/auth/token/refresh', { refresh_token: decrypt(row.refresh_token_enc) });
    if (!data.access_token) throw new Error(JSON.stringify(data).slice(0, 200));
    await persistToken(data);
    return data.access_token;
  } catch (err) {
    await query(`UPDATE aliexpress_oauth SET last_error = $1, updated_at = now() WHERE id = 1`,
      [String(err.message || 'refresh failed').slice(0, 300)]).catch(() => {});
    return row.access_token || null; // fall back to the (maybe stale) token; caller handles failure
  }
}

export async function getConnection() {
  const { rows } = await query(
    `SELECT ae_user_id, access_token_expires_at, refresh_token_expires_at, connected_at, last_error,
            (access_token IS NOT NULL) AS has_token
       FROM aliexpress_oauth WHERE id = 1`,
  );
  return rows[0] || null;
}

export async function disconnect() {
  await query(`DELETE FROM aliexpress_oauth WHERE id = 1`);
}
