// =============================================================================
// /api/listings — the signed-in user's real eBay listings
// =============================================================================
// Returns:
//   { connected:false, listings:[] }                     not connected -> UI shows CTA
//   { connected:true, listings:[...] }                   connected (may be empty)
//   { connected:true, reconnect:true, listings:[] }      token died -> UI prompts reconnect

import express from 'express';
import { isEnabled as dbEnabled } from '../services/db.js';
import { getListings } from '../services/ebay-seller.js';

const router = express.Router();

router.use((req, res, next) => {
  if (!dbEnabled()) return res.status(503).json({ error: 'Database not configured.' });
  if (!req.user) return res.status(401).json({ error: 'Sign in to view your listings.' });
  next();
});

router.get('/', async (req, res) => {
  try {
    const listings = await getListings(req.user.id);
    if (listings === null) return res.json({ connected: false, listings: [] });
    res.json({ connected: true, listings });
  } catch (err) {
    if (err.code === 'ebay_refresh_failed') {
      return res.json({ connected: true, reconnect: true, listings: [] });
    }
    console.error('[listings] error:', err.message);
    res.json({ connected: true, listings: [], error: 'Could not load listings from eBay.' });
  }
});

export default router;
