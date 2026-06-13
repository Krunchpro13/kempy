// src/routes/admin.js  (mounted at /api/admin)
//
// Owner/admin management surface. Admins can VIEW the user roster; only an OWNER
// can change roles (promote/demote between 'admin' and 'member'). The 'owner' role
// itself is assigned via SQL, never through this API — that keeps the privilege-
// escalation surface tight (an admin can't mint owners or escalate themselves).

import express from 'express';
import { query, isEnabled as dbEnabled } from '../services/db.js';
import { requireAdmin, requireOwner } from '../services/authz.js';

const router = express.Router();

function requireDb(req, res, next) {
  if (!dbEnabled()) return res.status(503).json({ error: 'Database not configured.' });
  next();
}

// GET /api/admin/users — roster (owner/admin can view). `canManage` tells the UI
// whether to show promote/demote controls (owner only).
router.get('/users', requireDb, requireAdmin, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, email, name, role, subscription_status, created_at
         FROM users
        ORDER BY (role = 'owner') DESC, (role = 'admin') DESC, created_at DESC
        LIMIT 500`,
    );
    const selfId = req.user.id || req.user.user_id;
    res.json({ users: rows, canManage: req.user.role === 'owner' || (process.env.ADMIN_EMAIL && req.user.email === process.env.ADMIN_EMAIL), selfId });
  } catch (err) {
    console.error('[admin] GET users:', err.message);
    res.status(500).json({ error: 'Failed to load users.' });
  }
});

// PUT /api/admin/users/:id/role  { role: 'admin' | 'member' } — OWNER only.
// Guards: whitelist role; can't set 'owner' (SQL-only); can't change your own
// role; can't modify an existing owner.
router.put('/users/:id/role', requireDb, requireOwner, async (req, res) => {
  const targetId = Number(req.params.id);
  const role = String((req.body && req.body.role) || '');
  if (!Number.isInteger(targetId)) return res.status(400).json({ error: 'Bad user id.' });
  if (!['admin', 'member'].includes(role)) {
    return res.status(400).json({ error: "Role must be 'admin' or 'member' (owner is assigned via SQL)." });
  }
  const selfId = req.user.id || req.user.user_id;
  if (targetId === selfId) return res.status(400).json({ error: "You can't change your own role." });

  try {
    const cur = await query('SELECT id, email, role FROM users WHERE id = $1', [targetId]);
    if (!cur.rows.length) return res.status(404).json({ error: 'User not found.' });
    if (cur.rows[0].role === 'owner') {
      return res.status(403).json({ error: "Can't modify an owner here — owner changes are SQL-only." });
    }
    await query('UPDATE users SET role = $1, updated_at = now() WHERE id = $2', [role, targetId]);
    console.log(`[admin] ${req.user.email} set user ${targetId} (${cur.rows[0].email}) role -> ${role}`);
    res.json({ ok: true, id: targetId, role });
  } catch (err) {
    console.error('[admin] PUT role:', err.message);
    res.status(500).json({ error: 'Failed to update role.' });
  }
});

export default router;
