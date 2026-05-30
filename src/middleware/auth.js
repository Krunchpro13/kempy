// src/middleware/auth.js
//
// Reads the kempy_session cookie, validates it against the sessions table,
// and attaches the user to req.user.
//
// If no valid session → req.user = null (not an error; let routes decide).
// Mount ONCE in server.js before any route that needs req.user:
//   import { sessionMiddleware } from './src/middleware/auth.js';
//   app.use(sessionMiddleware);

import { findUserBySession } from '../services/auth.js';
import { isEnabled as dbEnabled } from '../services/db.js';

const COOKIE_NAME = 'kempy_session';

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    let v = part.slice(eq + 1).trim();
    try { v = decodeURIComponent(v); } catch (_) { /* leave raw if malformed */ }
    if (k) out[k] = v;
  }
  return out;
}

export async function sessionMiddleware(req, _res, next) {
  req.user = null;
  if (!dbEnabled()) return next();
  try {
    const token = parseCookies(req)[COOKIE_NAME];
    if (token) {
      const user = await findUserBySession(token);
      if (user) {
        // Normalise: watchlist route checks req.user.user_id (legacy shape)
        // and auth/me checks req.user.id. Expose both.
        req.user = { ...user, user_id: user.id };
      }
    }
  } catch (err) {
    console.error('[sessionMiddleware]', err.message);
  }
  next();
}
