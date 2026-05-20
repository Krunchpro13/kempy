// =============================================================================
// /api/watchlist routes
// =============================================================================

import { Router } from 'express';
import * as db from '../services/db.js';
import {
  addToWatchlist,
  listWatchlist,
  removeFromWatchlist,
  refreshAllWatchlistPrices,
} from '../services/watchlist.js';

const router = Router();

// Guard: every route in here requires Postgres
router.use((req, res, next) => {
  if (!db.isEnabled()) {
    return res.status(503).json({
      error: 'Watchlist requires DATABASE_URL. Set it in .env, then run `npm run migrate`.',
    });
  }
  next();
});

// GET /api/watchlist — list all
router.get('/', async (req, res) => {
  try {
    const items = await listWatchlist();
    res.json({ items, count: items.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/watchlist — save a product
router.post('/', async (req, res) => {
  const product = req.body;
  if (!product || !product.name || !product.ebayPrice) {
    return res.status(400).json({ error: 'name and ebayPrice required' });
  }
  try {
    const saved = await addToWatchlist(product);
    if (!saved) {
      return res.status(409).json({ error: 'Already in watchlist (same ASIN)' });
    }
    res.status(201).json(saved);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/watchlist/:id
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'id must be an integer' });
  }
  try {
    const ok = await removeFromWatchlist(id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/watchlist/refresh — re-fetch prices for everything
router.post('/refresh', async (req, res) => {
  try {
    const result = await refreshAllWatchlistPrices();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
