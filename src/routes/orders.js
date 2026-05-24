// =============================================================================
// /api/orders routes
// =============================================================================

import { Router } from 'express';
import * as db from '../services/db.js';

const router = Router();

// Guard: every route in here requires Postgres
router.use((req, res, next) => {
  if (!db.isEnabled()) {
    return res.status(503).json({
      error: 'Orders requires DATABASE_URL. Set it in .env, then run `npm run migrate`.',
    });
  }
  next();
});

// GET /api/orders — list all
router.get('/', async (req, res) => {
  res.json({ orders: [] });
});

export default router;
