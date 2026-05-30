// src/routes/ebay-listings.js
//
// Listing-creation endpoints (mounted on /api/ebay alongside ebay.js):
//   GET  /api/ebay/listing-setup-status  — is the account ready to publish?
//   POST /api/ebay/listing-setup         — save address + auto-create policies/location
//   POST /api/ebay/list                  — publish a live listing from a product
//
// Handled (expected) failures return HTTP 200 { ok:false, step, detail } so the
// modal can show exactly which step failed and eBay's reason. Only unexpected
// errors hit the 500 path.

import express from 'express';
import { isEnabled as dbEnabled } from '../services/db.js';
import * as oauth from '../services/ebay-oauth.js';
import { getSetupStatus, saveSellerAddress, runFullSetup, EbayStepError } from '../services/ebay-account.js';
import { publishProduct } from '../services/ebay-listing.js';
import { requireSubscription } from '../middleware/subscription.js';

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in to continue.' });
  next();
}
function requireDb(req, res, next) {
  if (!dbEnabled()) return res.status(503).json({ error: 'Database not configured.' });
  next();
}

// Translate an EbayStepError / refresh failure into a 200 { ok:false } the UI can read.
function handled(res, err) {
  if (err?.code === 'ebay_refresh_failed') {
    return res.json({ ok: false, step: 'auth', detail: 'Reconnect your eBay account.' });
  }
  if (err instanceof EbayStepError || err?.code === 'ebay_step_failed') {
    return res.json({ ok: false, step: err.step, detail: err.detail });
  }
  return null; // not a handled error
}

// GET /api/ebay/listing-setup-status
router.get('/listing-setup-status', requireDb, requireAuth, async (req, res, next) => {
  try {
    const conn = await oauth.getConnection(req.user.id);
    const canList = !!conn && oauth.scopesCanList(conn.scopes);
    const status = await getSetupStatus(req.user.id);
    res.json({
      connected: !!conn,
      canList,
      ready: status.ready,
      hasAddress: status.hasAddress,
      missing: status.missing,
      marketplace: status.marketplace,
      lastError: status.prefs?.last_error || null,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/ebay/listing-setup  { country, postalCode, addressLine1?, city?, stateOrProvince? }
router.post('/listing-setup', requireDb, requireAuth, requireSubscription, async (req, res, next) => {
  const { country, postalCode } = req.body || {};
  if (!postalCode) return res.json({ ok: false, step: 'address', detail: 'Postal/ZIP code is required.' });
  try {
    await saveSellerAddress(req.user.id, req.body || {});
    const status = await runFullSetup(req.user.id);
    res.json({ ok: true, ready: status.ready, missing: status.missing });
  } catch (err) {
    if (handled(res, err)) return;
    next(err);
  }
});

// POST /api/ebay/list  { product, title, price, quantity, condition, description }
router.post('/list', requireDb, requireAuth, requireSubscription, async (req, res, next) => {
  const { product, title, price, quantity, condition, description } = req.body || {};
  if (!product || !(product.name || title)) {
    return res.json({ ok: false, step: 'input', detail: 'Missing product details.' });
  }
  try {
    const result = await publishProduct(req.user.id, { product, title, price, quantity, condition, description });
    res.json(result); // { ok:true, listingId, url, sku, offerId }
  } catch (err) {
    if (handled(res, err)) return;
    console.error('[ebay-list] unexpected:', err.message);
    next(err);
  }
});

export default router;
