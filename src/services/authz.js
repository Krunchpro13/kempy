// src/services/authz.js
//
// Central role-based authorization. Roles live on `users.role`
// ('owner' | 'admin' | 'member'), populated onto req.user by the session
// middleware. This replaces matching a hardcoded ADMIN_EMAIL — ownership is now
// durable data on the account (by id), survives email changes, and supports
// multiple admins.
//
//   owner  — root; manages admins; full powers. Assigned via SQL (rare).
//   admin  — elevated; can connect the shared AliExpress account + admin screens.
//            Promoted/demoted by an owner in the in-app admin screen.
//   member — default; a regular subscriber.
//
// ADMIN_EMAIL is kept ONLY as a bootstrap fallback inside isOwner(): it elevates a
// matching email to owner so admin access never breaks before an owner row is set.
// Remove the env var once `role='owner'` exists in the DB.

export function isOwner(user) {
  if (!user) return false;
  if (user.role === 'owner') return true;
  const admin = process.env.ADMIN_EMAIL;
  return !!(admin && user.email === admin);
}

export function isAdmin(user) {
  if (!user) return false;
  return isOwner(user) || user.role === 'admin';
}

export function requireOwner(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in to continue.' });
  if (!isOwner(req.user)) return res.status(403).json({ error: 'Owner only.' });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in to continue.' });
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admin only.' });
  next();
}
