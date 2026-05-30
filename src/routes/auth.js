// src/routes/auth.js
//
// /api/auth/* endpoints. Mounted in server.js with:
//   import authRouter from './src/routes/auth.js';
//   app.use('/api/auth', authRouter);

import express from 'express';
import {
  hashPassword, verifyPassword,
  createOtp, verifyOtp,
  createSession, findUserBySession, deleteSession, deleteAllSessionsForUser,
  findUserByEmail, createOrUpdateUser, markEmailVerified,
  setPassword, updateName,
} from '../services/auth.js';
import { sendOtpEmail, sendWelcomeEmail } from '../services/email.js';
import { isEnabled as dbEnabled } from '../services/db.js';

const router = express.Router();
const COOKIE_NAME = 'kempy_session';

// ====================================================================
// Helpers
// ====================================================================
function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  const out = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function setSessionCookie(res, token, expiresAt) {
  const isProd = process.env.NODE_ENV === 'production';
  const maxAge = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    `Max-Age=${maxAge}`,
    'SameSite=Lax',
  ];
  if (isProd) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: 'owner',                      // single-tenant for now; team roles arrive later
    email_verified_at: u.email_verified_at,
    subscription_status: u.subscription_status || null,
    current_period_end: u.current_period_end || null,
  };
}

function dbRequired(_req, res, next) {
  if (!dbEnabled()) {
    return res.status(503).json({
      error: 'Auth requires a database. Set DATABASE_URL in .env and run `npm run migrate`.',
    });
  }
  next();
}

// req.user is set by sessionMiddleware (server.js) from the session cookie.
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in to continue.' });
  next();
}

// ====================================================================
// POST /api/auth/signup
// Creates an unverified user + emails them an OTP.
// Returns { ok: true, email } — same response shape whether the email
// is new or a duplicate-unverified retry, to discourage account enumeration.
// ====================================================================
router.post('/signup', dbRequired, async (req, res) => {
  try {
    const { email, password, name } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const existing = await findUserByEmail(email);
    if (existing && existing.email_verified_at) {
      // Don't reveal whether the email exists — same shape as success path.
      // (User will find out at login if they try to use this email.)
      return res.json({ ok: true, email });
    }

    const passwordHash = await hashPassword(password);
    await createOrUpdateUser({
      email,
      name: name || email.split('@')[0],
      passwordHash,
    });

    const code = await createOtp(email, 'signup');
    try {
      await sendOtpEmail(email, code);
    } catch (err) {
      // Email send failure should not break signup — log and continue.
      // User can hit Resend to retry.
      console.error('[auth/signup] email send failed:', err.message);
    }

    res.json({ ok: true, email });
  } catch (err) {
    console.error('[auth/signup]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ====================================================================
// POST /api/auth/otp/verify
// Body: { email, code }
// On success: marks user verified, creates session, sets cookie.
// ====================================================================
router.post('/otp/verify', dbRequired, async (req, res) => {
  try {
    const { email, code } = req.body || {};
    if (!email || !code) return res.status(400).json({ error: 'Email and code required' });

    const result = await verifyOtp(email, code, 'signup');
    if (!result.ok) {
      const msg = {
        no_code: 'No pending verification — please sign up again',
        expired: 'Code expired — request a new one',
        wrong_code: `Wrong code${result.attemptsLeft != null ? ` (${result.attemptsLeft} ${result.attemptsLeft === 1 ? 'attempt' : 'attempts'} left)` : ''}`,
        too_many_attempts: 'Too many failed attempts — request a new code',
      }[result.reason] || 'Verification failed';
      return res.status(400).json({ error: msg });
    }

    await markEmailVerified(email);
    const user = await findUserByEmail(email);

    const { token, expiresAt } = await createSession(user.id, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    setSessionCookie(res, token, expiresAt);

    // Welcome email — fire-and-forget; don't block response
    sendWelcomeEmail(user.email, user.name).catch(err =>
      console.error('[auth] welcome email failed:', err.message)
    );

    res.json({ ok: true, user: publicUser(user) });
  } catch (err) {
    console.error('[auth/otp/verify]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ====================================================================
// POST /api/auth/otp/resend
// Body: { email }
// Always responds 200 to prevent email enumeration.
// ====================================================================
router.post('/otp/resend', dbRequired, async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email required' });

    // Only resend if there's a user with this email and they're not yet verified
    const user = await findUserByEmail(email);
    if (user && !user.email_verified_at) {
      const code = await createOtp(email, 'signup');
      try { await sendOtpEmail(email, code); }
      catch (err) { console.error('[auth/otp/resend] email send failed:', err.message); }
    }
    // Same response regardless
    res.json({ ok: true });
  } catch (err) {
    console.error('[auth/otp/resend]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ====================================================================
// POST /api/auth/login
// Body: { email, password }
// ====================================================================
router.post('/login', dbRequired, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await findUserByEmail(email);
    if (!user || !user.password_hash) {
      // Constant time delay to discourage email enumeration via timing
      await new Promise(r => setTimeout(r, 200));
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (!user.email_verified_at) {
      return res.status(403).json({ error: 'Email not verified — check your inbox for the code' });
    }

    const { token, expiresAt } = await createSession(user.id, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    setSessionCookie(res, token, expiresAt);
    res.json({ ok: true, user: publicUser(user) });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ====================================================================
// GET /api/auth/me
// Returns the current user or { user: null }. Never requires auth itself —
// it's the way the frontend asks "am I logged in?"
// ====================================================================
router.get('/me', async (req, res) => {
  try {
    if (!dbEnabled()) return res.json({ user: null });
    const cookies = parseCookies(req);
    const token = cookies[COOKIE_NAME];
    if (!token) return res.json({ user: null });
    const user = await findUserBySession(token);
    if (!user) {
      clearSessionCookie(res);
      return res.json({ user: null });
    }
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error('[auth/me]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ====================================================================
// POST /api/auth/logout
// ====================================================================
router.post('/logout', async (req, res) => {
  try {
    const cookies = parseCookies(req);
    const token = cookies[COOKIE_NAME];
    if (token && dbEnabled()) {
      try { await deleteSession(token); } catch (err) { console.error('[auth/logout]', err.message); }
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (err) {
    console.error('[auth/logout]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ====================================================================
// POST /api/auth/change-password   { currentPassword, newPassword }
// Verifies the current password, sets a new one, and revokes all OTHER
// sessions (the current one stays signed in).
// ====================================================================
router.post('/change-password', dbRequired, requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required.' });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    }

    // req.user (from sessionMiddleware) has no password_hash — fetch the full row.
    const full = await findUserByEmail(req.user.email);
    if (!full || !full.password_hash) {
      return res.status(400).json({ error: 'This account has no password set (social login?).' });
    }

    const ok = await verifyPassword(currentPassword, full.password_hash);
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect.' });

    await setPassword(full.id, await hashPassword(newPassword));

    // Security: revoke every other session, keep the current cookie valid.
    const token = parseCookies(req)[COOKIE_NAME];
    try { await deleteAllSessionsForUser(full.id, token); } catch (e) { console.error('[auth/change-password] revoke', e.message); }

    res.json({ ok: true });
  } catch (err) {
    console.error('[auth/change-password]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ====================================================================
// POST /api/auth/profile   { name }
// ====================================================================
router.post('/profile', dbRequired, requireAuth, async (req, res) => {
  try {
    const name = (req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Name is required.' });
    await updateName(req.user.id, name);
    const updated = await findUserByEmail(req.user.email);
    res.json({ ok: true, user: publicUser(updated) });
  } catch (err) {
    console.error('[auth/profile]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ====================================================================
// POST /api/auth/logout-all
// Ends every session except the current one.
// ====================================================================
router.post('/logout-all', dbRequired, requireAuth, async (req, res) => {
  try {
    const token = parseCookies(req)[COOKIE_NAME];
    await deleteAllSessionsForUser(req.user.id, token);
    res.json({ ok: true });
  } catch (err) {
    console.error('[auth/logout-all]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
