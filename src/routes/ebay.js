// src/routes/ebay.js
//
// eBay SELLER OAuth endpoints (mounted at /api/ebay).
//
//   GET  /api/ebay/connect      — redirect the user to eBay to consent
//   GET  /api/ebay/callback     — eBay redirects here with ?code=; store tokens
//   GET  /api/ebay/status       — { connected, configured, marketplace, scopes, ... }
//   POST /api/ebay/disconnect   — forget the user's eBay tokens
//
// connect/status/disconnect require an authed session. The callback also needs
// the session (the kempy_session cookie rides the top-level redirect back).

import express from 'express';
import crypto from 'crypto';
import { isEnabled as dbEnabled } from '../services/db.js';
import { setOAuthState, getOAuthState, clearCachedEbay } from '../services/cache.js';
import * as oauth from '../services/ebay-oauth.js';

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in to connect eBay.' });
  next();
}
function requireDb(req, res, next) {
  if (!dbEnabled()) return res.status(503).json({ error: 'Database not configured.' });
  next();
}

// GET /api/ebay/connect -> 302 to eBay consent
router.get('/connect', requireDb, requireAuth, async (req, res, next) => {
  try {
    if (!oauth.isConfigured()) {
      return res
        .status(503)
        .json({ error: 'eBay seller integration is not configured yet (missing keys/RuName).' });
    }
    const state = crypto.randomBytes(16).toString('hex');
    await setOAuthState(state, req.user.id);
    res.redirect(oauth.buildConsentUrl(state));
  } catch (err) {
    next(err);
  }
});

// GET /api/ebay/callback?code=&state= (browser redirect from eBay)
router.get('/callback', requireDb, async (req, res) => {
  const { code, state, error, error_description } = req.query;
  const back = (qs) => res.redirect('/app/settings.html?panel=stores&' + qs);
  const detail = (d) => '&detail=' + encodeURIComponent(String(d || '').slice(0, 140));

  if (error) {
    console.error('[ebay] consent error:', error, '|', error_description);
    // access_denied = the user actually declined; anything else is a config/scope problem.
    if (error === 'access_denied') return back('ebay=denied');
    return back('ebay=error' + detail(error_description || error));
  }
  if (!req.user) return res.redirect('/auth/login.html?next=/app/settings.html');
  if (!code) return back('ebay=error' + detail('eBay returned no authorization code'));

  try {
    // CSRF: if we stored state (Redis up), it must map back to this user.
    const saved = await getOAuthState(state);
    if (saved && String(saved.userId) !== String(req.user.id)) {
      return back('ebay=error' + detail('Session mismatch — try again'));
    }
    await oauth.exchangeCode(req.user.id, code);
    await clearCachedEbay(req.user.id);
    back('ebay=connected');
  } catch (err) {
    // Surface the eBay token-exchange error so we can diagnose (e.g. invalid_grant, scope).
    const apiDetail = err.detail || err.response?.data?.error_description || err.message;
    console.error('[ebay] callback failed:', apiDetail);
    back('ebay=error' + detail(apiDetail));
  }
});

// GET /api/ebay/status
router.get('/status', requireDb, requireAuth, async (req, res, next) => {
  try {
    const c = await oauth.getConnection(req.user.id);
    res.json({
      connected: !!c,
      configured: oauth.isConfigured(),
      canList: !!c && oauth.scopesCanList(c.scopes),
      ebayUser: c?.ebay_user_id || null,
      marketplace: c?.marketplace_id || null,
      scopes: c?.scopes || null,
      connectedAt: c?.connected_at || null,
      refreshExpiresAt: c?.refresh_token_expires_at || null,
      lastError: c?.last_error || null,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/ebay/disconnect
router.post('/disconnect', requireDb, requireAuth, async (req, res, next) => {
  try {
    await oauth.disconnect(req.user.id);
    await clearCachedEbay(req.user.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
