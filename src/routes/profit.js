// =============================================================================
// /api/profit?period=7|30|90|365 — profit analytics from the user's eBay orders
// =============================================================================
// Cached per-user + period (~5 min). Profit = sale - real eBay fees (supplier
// cost not yet tracked; see ebay-seller.getProfit).

import express from 'express';
import { isEnabled as dbEnabled } from '../services/db.js';
import { getProfit } from '../services/ebay-seller.js';
import { getCachedEbay, setCachedEbay } from '../services/cache.js';

const router = express.Router();

router.use((req, res, next) => {
  if (!dbEnabled()) return res.status(503).json({ error: 'Database not configured.' });
  if (!req.user) return res.status(401).json({ error: 'Sign in to view profit.' });
  next();
});

router.get('/', async (req, res) => {
  const period = [7, 30, 90, 365].includes(Number(req.query.period)) ? Number(req.query.period) : 30;
  try {
    const cached = await getCachedEbay(req.user.id, `profit:${period}`);
    if (cached) return res.json(cached);

    const data = await getProfit(req.user.id, period);
    if (data === null) {
      return res.json({ connected: false, series: [], topProducts: [], channels: [], transactions: [] });
    }
    const payload = { connected: true, period, ...data };
    await setCachedEbay(req.user.id, `profit:${period}`, payload);
    res.json(payload);
  } catch (err) {
    if (err.code === 'ebay_refresh_failed') {
      return res.json({ connected: true, reconnect: true, series: [], topProducts: [], channels: [], transactions: [] });
    }
    console.error('[profit] error:', err.message);
    res.json({ connected: true, series: [], topProducts: [], channels: [], transactions: [], error: 'Could not load profit from eBay.' });
  }
});

export default router;
