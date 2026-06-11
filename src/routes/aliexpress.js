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
// Only the owner should connect the shared sourcing account. If ADMIN_EMAIL is
// set, require it; otherwise any authenticated user may connect (the owner).
function requireOwner(req, res, next) {
  if (!req.user) return res.redirect('/auth/login.html?next=/app/settings.html?panel=stores');
  const admin = process.env.ADMIN_EMAIL;
  if (admin && req.user.email !== admin) return res.status(403).send('Not authorised to connect AliExpress.');
  next();
}

// GET /api/aliexpress/connect
router.get('/connect', requireDb, requireOwner, (req, res) => {
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
router.get('/status', requireDb, async (req, res) => {
  try {
    const c = await ae.getConnection();
    res.json({
      configured: ae.isConfigured(),
      connected: !!(c && c.has_token),
      aeUserId: c?.ae_user_id || null,
      connectedAt: c?.connected_at || null,
      lastError: c?.last_error || null,
    });
  } catch {
    res.json({ configured: ae.isConfigured(), connected: false });
  }
});

// POST /api/aliexpress/disconnect
router.post('/disconnect', requireDb, requireOwner, async (req, res) => {
  await ae.disconnect();
  res.json({ ok: true });
});

// TEMP DIAGNOSTIC — discover valid DS feed names + test recommend.feed.get.
// Owner-gated; returns only non-secret data. Remove after feed names are fixed.
router.get('/diag', requireDb, requireOwner, async (req, res) => {
  try {
    const token = await ae.getValidAccessToken();
    if (!token) return res.json({ error: 'no token stored' });
    const out = {};
    try {
      const feeds = await ae.callSigned('aliexpress.ds.feedname.get', {}, { accessToken: token });
      out.feednames = JSON.stringify(feeds).slice(0, 2500);
    } catch (e) { out.feednamesError = e.message; }
    const feedName = req.query.feed || 'DS bestselling';
    try {
      const prods = await ae.callSigned('aliexpress.ds.recommend.feed.get',
        { feed_name: feedName, target_currency: 'GBP', target_language: 'EN', country: 'UK', page_no: '1', page_size: '3' },
        { accessToken: token });
      out.feedTried = feedName;
      out.recommendSample = JSON.stringify(prods).slice(0, 2000);
    } catch (e) { out.recommendError = e.message; }
    res.json(out);
  } catch (e) {
    res.json({ error: e.message });
  }
});

export default router;
