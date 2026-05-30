// src/routes/billing.js
//
// Billing endpoints (mounted /api/billing). The Stripe webhook is NOT here —
// it's registered in server.js before express.json() so the raw body survives.
//
//   GET  /api/billing/status    — subscription state for the current user
//   POST /api/billing/checkout  — Stripe Checkout session URL (subscribe)
//   POST /api/billing/portal    — Stripe Billing Portal URL (manage/cancel)

import express from 'express';
import { isEnabled as dbEnabled } from '../services/db.js';
import * as billing from '../services/billing.js';

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in to continue.' });
  next();
}
function requireDb(req, res, next) {
  if (!dbEnabled()) return res.status(503).json({ error: 'Database not configured.' });
  next();
}
function requireStripe(req, res, next) {
  if (!billing.isEnabled()) return res.status(503).json({ error: 'Billing is not configured yet.' });
  next();
}

// GET /api/billing/status
router.get('/status', requireDb, requireAuth, (req, res) => {
  res.json({
    enabled: billing.isEnabled(),
    subscribed: billing.isSubscribed(req.user),
    status: req.user.subscription_status || null,
    currentPeriodEnd: req.user.current_period_end || null,
    plan: req.user.plan || null,
  });
});

// POST /api/billing/checkout
router.post('/checkout', requireDb, requireAuth, requireStripe, async (req, res, next) => {
  try {
    const url = await billing.createCheckoutSession(req.user);
    res.json({ url });
  } catch (err) {
    console.error('[billing] checkout:', err.message);
    res.status(500).json({ error: 'Could not start checkout.' });
  }
});

// POST /api/billing/portal
router.post('/portal', requireDb, requireAuth, requireStripe, async (req, res, next) => {
  try {
    if (!req.user.stripe_customer_id) {
      return res.status(400).json({ error: 'No billing account yet — subscribe first.' });
    }
    const url = await billing.createPortalSession(req.user);
    res.json({ url });
  } catch (err) {
    console.error('[billing] portal:', err.message);
    res.status(500).json({ error: 'Could not open billing portal.' });
  }
});

export default router;
