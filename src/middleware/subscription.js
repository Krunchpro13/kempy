// src/middleware/subscription.js
//
// Gate the "money" features behind an active Stripe subscription (freemium model:
// research + watchlist stay free). Fails OPEN when billing isn't configured yet,
// so the app keeps working pre-launch; enforces once STRIPE_SECRET_KEY is set.

import * as billing from '../services/billing.js';

export function requireSubscription(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in to continue.' });
  if (!billing.isEnabled()) return next(); // billing not set up yet — don't block
  if (billing.isSubscribed(req.user)) return next();
  return res.status(402).json({
    error: 'An active subscription is required for this feature.',
    code: 'subscription_required',
  });
}
