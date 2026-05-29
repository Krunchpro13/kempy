// =============================================================================
// /api/team routes — DB-backed team roster for the signed-in owner.
//
//   GET    /api/team            list owner + members
//   POST   /api/team            invite { email, role }
//   PATCH  /api/team/:id        change a member's role { role }
//   DELETE /api/team/:id        remove a member
//   POST   /api/team/:id/resend re-stamp a pending invite
//
// NOTE: invited members can't yet log into the owner's workspace with scoped
// access — that needs the multi-tenant auth model. This persists the roster
// and invite state, which is the real MVP slice.
// =============================================================================

import { Router } from 'express';
import { isEnabled as dbEnabled, query } from '../services/db.js';

const router = Router();
const SEAT_LIMIT = 5;                 // includes the owner
const ROLES = ['admin', 'member', 'viewer'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.use((req, res, next) => {
  if (!dbEnabled()) {
    return res.status(503).json({ error: 'Team requires DATABASE_URL. Set it in .env and run npm run migrate.' });
  }
  if (!req.user) return res.status(401).json({ error: 'Sign in to manage your team.' });
  next();
});

function mapMember(r) {
  return {
    id: String(r.id),
    email: r.email,
    name: r.name,
    role: r.role,
    status: r.status,
    invitedAt: r.invited_at,
  };
}

// GET /api/team
router.get('/', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, email, name, role, status, invited_at
         FROM team_members WHERE owner_user_id = $1
        ORDER BY invited_at ASC`,
      [req.user.id],
    );
    res.json({
      owner: { name: req.user.name, email: req.user.email },
      members: rows.map(mapMember),
      seatLimit: SEAT_LIMIT,
    });
  } catch (err) {
    console.error('[team] GET', err.message);
    res.status(500).json({ error: 'Failed to load team.' });
  }
});

// POST /api/team  { email, role }
router.post('/', async (req, res) => {
  const email = (req.body?.email || '').trim().toLowerCase();
  const role = (req.body?.role || 'member').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role.' });
  if (email === (req.user.email || '').toLowerCase()) {
    return res.status(400).json({ error: "That's your own account — you're already the owner." });
  }
  try {
    const { rows: cnt } = await query(
      `SELECT COUNT(*)::int AS n FROM team_members WHERE owner_user_id = $1`,
      [req.user.id],
    );
    if (cnt[0].n >= SEAT_LIMIT - 1) {
      return res.status(403).json({ error: `Seat limit reached (${SEAT_LIMIT}). Upgrade to invite more.` });
    }
    const { rows } = await query(
      `INSERT INTO team_members (owner_user_id, email, role, status)
       VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (owner_user_id, email) DO NOTHING
       RETURNING id, email, name, role, status, invited_at`,
      [req.user.id, email, role],
    );
    if (!rows.length) return res.status(409).json({ error: 'That email is already on your team.' });
    res.json({ ok: true, member: mapMember(rows[0]) });
  } catch (err) {
    console.error('[team] POST', err.message);
    res.status(500).json({ error: 'Failed to add member.' });
  }
});

// PATCH /api/team/:id  { role }
router.patch('/:id', async (req, res) => {
  const role = (req.body?.role || '').trim().toLowerCase();
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role.' });
  try {
    const { rows } = await query(
      `UPDATE team_members SET role = $1, updated_at = NOW()
        WHERE id = $2 AND owner_user_id = $3
        RETURNING id, email, name, role, status, invited_at`,
      [role, req.params.id, req.user.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Member not found.' });
    res.json({ ok: true, member: mapMember(rows[0]) });
  } catch (err) {
    console.error('[team] PATCH', err.message);
    res.status(500).json({ error: 'Failed to update member.' });
  }
});

// DELETE /api/team/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await query(
      `DELETE FROM team_members WHERE id = $1 AND owner_user_id = $2 RETURNING id`,
      [req.params.id, req.user.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Member not found.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[team] DELETE', err.message);
    res.status(500).json({ error: 'Failed to remove member.' });
  }
});

// POST /api/team/:id/resend
router.post('/:id/resend', async (req, res) => {
  try {
    const { rows } = await query(
      `UPDATE team_members SET invited_at = NOW()
        WHERE id = $1 AND owner_user_id = $2 AND status = 'pending' RETURNING id`,
      [req.params.id, req.user.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Pending invite not found.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[team] resend', err.message);
    res.status(500).json({ error: 'Failed to resend invite.' });
  }
});

export default router;
