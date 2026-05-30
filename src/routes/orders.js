// =============================================================================
// /api/orders — the signed-in user's real eBay orders
// =============================================================================
// Cached per-user (~5 min) to relieve Sell API rate limits.

import express from 'express';
import { isEnabled as dbEnabled } from '../services/db.js';
import { getOrders } from '../services/ebay-seller.js';
import { getCachedEbay, setCachedEbay } from '../services/cache.js';

const router = express.Router();

router.use((req, res, next) => {
  if (!dbEnabled()) return res.status(503).json({ error: 'Database not configured.' });
  if (!req.user) return res.status(401).json({ error: 'Sign in to view your orders.' });
  next();
});

router.get('/', async (req, res) => {
  try {
    const cached = await getCachedEbay(req.user.id, 'orders');
    if (cached) return res.json(cached);

    const orders = await getOrders(req.user.id);
    if (orders === null) return res.json({ connected: false, orders: [] });

    const payload = { connected: true, orders };
    await setCachedEbay(req.user.id, 'orders', payload);
    res.json(payload);
  } catch (err) {
    if (err.code === 'ebay_refresh_failed') {
      return res.json({ connected: true, reconnect: true, orders: [] });
    }
    console.error('[orders] error:', err.message);
    res.json({ connected: true, orders: [], error: 'Could not load orders from eBay.' });
  }
});

export default router;
