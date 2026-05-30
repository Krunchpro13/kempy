// =============================================================================
// /api/settings routes — per-user preferences (notifications, currency, etc.)
// Stored in users.preferences (JSONB).
//
//   GET /api/settings                 → { notifications, currency }
//   PUT /api/settings/notifications    { notifications: {...} }
//   PUT /api/settings/currency         { currency: "USD" }
// =============================================================================

import { Router } from 'express';
import { isEnabled as dbEnabled, query } from '../services/db.js';
import { SUPPORTED_CURRENCIES as ALLOWED_CURRENCIES } from '../config.js';

const router = Router();

router.use((req, res, next) => {
  if (!dbEnabled()) {
    return res.status(503).json({ error: 'Settings require DATABASE_URL. Set it in .env and run npm run migrate.' });
  }
  if (!req.user) return res.status(401).json({ error: 'Sign in to manage settings.' });
  next();
});

// GET /api/settings
router.get('/', async (req, res) => {
  try {
    const { rows } = await query(`SELECT preferences FROM users WHERE id = $1`, [req.user.id]);
    const prefs = rows[0]?.preferences || {};
    res.json({ notifications: prefs.notifications || {}, currency: prefs.currency || 'USD' });
  } catch (err) {
    console.error('[settings] GET', err.message);
    res.status(500).json({ error: 'Failed to load settings.' });
  }
});

// PUT /api/settings/notifications  { notifications: { key: bool, ... } }
router.put('/notifications', async (req, res) => {
  const incoming = req.body?.notifications;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return res.status(400).json({ error: 'notifications object required.' });
  }
  // Coerce to a flat { string: boolean } map — don't trust arbitrary client shapes.
  const clean = {};
  for (const [k, v] of Object.entries(incoming)) {
    if (typeof k === 'string' && k.length <= 64) clean[k] = !!v;
  }
  try {
    await query(
      `UPDATE users
          SET preferences = jsonb_set(COALESCE(preferences, '{}'::jsonb), '{notifications}', $1::jsonb, true),
              updated_at = NOW()
        WHERE id = $2`,
      [JSON.stringify(clean), req.user.id],
    );
    res.json({ ok: true, notifications: clean });
  } catch (err) {
    console.error('[settings] PUT notifications', err.message);
    res.status(500).json({ error: 'Failed to save preferences.' });
  }
});

// PUT /api/settings/currency  { currency: "USD" }
router.put('/currency', async (req, res) => {
  const currency = String(req.body?.currency || '').toUpperCase();
  if (!ALLOWED_CURRENCIES.includes(currency)) {
    return res.status(400).json({ error: 'Unsupported currency.' });
  }
  try {
    await query(
      `UPDATE users
          SET preferences = jsonb_set(COALESCE(preferences, '{}'::jsonb), '{currency}', $1::jsonb, true),
              updated_at = NOW()
        WHERE id = $2`,
      [JSON.stringify(currency), req.user.id],
    );
    res.json({ ok: true, currency });
  } catch (err) {
    console.error('[settings] PUT currency', err.message);
    res.status(500).json({ error: 'Failed to save currency.' });
  }
});

export default router;
