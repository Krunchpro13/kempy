// src/routes/aliexpress.js  (mounted at /api/aliexpress)
//
// APP-LEVEL AliExpress Dropshipping (DS) OAuth connect for KEMPY's own sourcing
// account. One shared token powers the AliExpress research mode for everyone.
// The owner connects once:
//   GET /api/aliexpress/connect    -> 302 to AliExpress consent (owner only)
//   GET /api/aliexpress/callback   -> AE redirects here with ?code=; store token
//   GET /api/aliexpress/status     -> { configured, connected, aeUserId, ... }
//   POST /api/aliexpress/disconnect

import express from 'express';
import crypto from 'crypto';
import { isEnabled as dbEnabled } from '../services/db.js';
import * as ae from '../services/providers/aliexpress-oauth.js';
import { isAdmin } from '../services/authz.js';

const router = express.Router();

// Short-lived CSRF state (single-instance in-memory; fine for a one-time owner action).
const states = new Map(); // state -> expiresAt(ms)
function newState() {
  const s = crypto.randomBytes(16).toString('hex');
  states.set(s, Date.now() + 10 * 60_000);
  return s;
}
function consumeState(s) {
  const exp = states.get(s);
  states.delete(s);
  // prune
  for (const [k, v] of states) if (v < Date.now()) states.delete(k);
  return !!exp && exp > Date.now();
}

function requireDb(req, res, next) {
  if (!dbEnabled()) return res.status(503).json({ error: 'Database not configured.' });
  next();
}
// Connecting the shared sourcing account is owner/admin-only (role-based, with
// ADMIN_EMAIL as a bootstrap fallback — see authz.isAdmin). Browser-friendly:
// redirect to login when signed out, 403 otherwise.
function requireConnectAuth(req, res, next) {
  if (!req.user) return res.redirect('/auth/login.html?next=/app/settings.html?panel=stores');
  if (!isAdmin(req.user)) return res.status(403).send('Not authorised to connect AliExpress.');
  next();
}

// GET /api/aliexpress/connect
router.get('/connect', requireDb, requireConnectAuth, (req, res) => {
  if (!ae.isConfigured()) return res.redirect('/app/settings.html?panel=stores&aliexpress=notconfigured');
  res.redirect(ae.buildAuthUrl(newState()));
});

// GET /api/aliexpress/callback?code=&state=
router.get('/callback', requireDb, async (req, res) => {
  const { code, state } = req.query;
  const back = (qs) => res.redirect('/app/settings.html?panel=stores&' + qs);
  if (!code) return back('aliexpress=error');
  if (state && !consumeState(String(state))) return back('aliexpress=badstate');
  try {
    await ae.exchangeCode(String(code));
    back('aliexpress=connected');
  } catch (err) {
    console.error('[aliexpress] callback failed:', err.message);
    back('aliexpress=error');
  }
});

// GET /api/aliexpress/status
// AliExpress is APP-LEVEL (one shared sourcing account). Only an owner/admin may
// connect it; `canConnect` tells the UI whether to show a Connect action vs a
// read-only "managed centrally" state. (Role-based via authz.isAdmin.)
function canConnect(req) {
  return isAdmin(req.user);
}

router.get('/status', requireDb, async (req, res) => {
  try {
    const c = await ae.getConnection();
    res.json({
      configured: ae.isConfigured(),
      connected: !!(c && c.has_token),
      canConnect: canConnect(req),
      aeUserId: c?.ae_user_id || null,
      connectedAt: c?.connected_at || null,
      lastError: c?.last_error || null,
    });
  } catch {
    res.json({ configured: ae.isConfigured(), connected: false, canConnect: canConnect(req) });
  }
});

// POST /api/aliexpress/disconnect
router.post('/disconnect', requireDb, requireConnectAuth, async (req, res) => {
  await ae.disconnect();
  res.json({ ok: true });
});

export default router;
