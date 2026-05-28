// src/services/auth.js
//
// Auth primitives — password hashing (scrypt), OTP, session tokens.
// All cryptography uses Node's built-in `crypto`; no third-party deps.
//
// Storage:
//   - users.password_hash → "scrypt$<salt-hex>$<hash-hex>"
//   - sessions.token_hash → sha256 of the cookie token
//   - otp_codes.code_hash → sha256 of the 6-digit code

import crypto from 'node:crypto';
import { query } from './db.js';

// ---------- Constants ----------
const OTP_TTL_MIN = 10;
const SESSION_TTL_DAYS = 30;
const MAX_OTP_ATTEMPTS = 5;
const SCRYPT_KEYLEN = 64;

// ====================================================================
// PASSWORD
// ====================================================================
export function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, (err, derived) => {
      if (err) return reject(err);
      resolve(`scrypt$${salt.toString('hex')}$${derived.toString('hex')}`);
    });
  });
}

export function verifyPassword(password, stored) {
  return new Promise((resolve, reject) => {
    if (!stored || typeof stored !== 'string') return resolve(false);
    const parts = stored.split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return resolve(false);
    let salt, expected;
    try {
      salt = Buffer.from(parts[1], 'hex');
      expected = Buffer.from(parts[2], 'hex');
    } catch {
      return resolve(false);
    }
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, (err, derived) => {
      if (err) return reject(err);
      try {
        resolve(crypto.timingSafeEqual(expected, derived));
      } catch {
        resolve(false);
      }
    });
  });
}

// ====================================================================
// OTP
// ====================================================================
export function generateOtp() {
  // 6 digits, 100000–999999
  return crypto.randomInt(100_000, 1_000_000).toString();
}

function hashOtp(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

// Invalidate any prior unused OTP for email+purpose, then insert a fresh one.
// Returns the plaintext code (caller emails it).
export async function createOtp(email, purpose = 'signup') {
  const code = generateOtp();
  const codeHash = hashOtp(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60_000);

  await query(
    `UPDATE otp_codes
       SET consumed_at = NOW()
     WHERE LOWER(email) = LOWER($1) AND purpose = $2 AND consumed_at IS NULL`,
    [email, purpose]
  );
  await query(
    `INSERT INTO otp_codes (email, code_hash, purpose, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [email, codeHash, purpose, expiresAt]
  );
  return code;
}

// Verify a code. Returns { ok: true } or { ok: false, reason, attemptsLeft? }
export async function verifyOtp(email, code, purpose = 'signup') {
  const codeHash = hashOtp(code);
  const { rows } = await query(
    `SELECT id, code_hash, expires_at, attempts FROM otp_codes
     WHERE LOWER(email) = LOWER($1) AND purpose = $2 AND consumed_at IS NULL
     ORDER BY id DESC LIMIT 1`,
    [email, purpose]
  );
  if (!rows.length) return { ok: false, reason: 'no_code' };
  const row = rows[0];
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  if (row.attempts >= MAX_OTP_ATTEMPTS) {
    return { ok: false, reason: 'too_many_attempts' };
  }
  if (row.code_hash !== codeHash) {
    await query(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
    return {
      ok: false,
      reason: 'wrong_code',
      attemptsLeft: MAX_OTP_ATTEMPTS - row.attempts - 1,
    };
  }
  await query(`UPDATE otp_codes SET consumed_at = NOW() WHERE id = $1`, [row.id]);
  return { ok: true };
}

// ====================================================================
// SESSIONS
// ====================================================================
export async function createSession(userId, { userAgent = null, ip = null } = {}) {
  const token = crypto.randomBytes(32).toString('hex');         // 64 hex chars
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await query(
    `INSERT INTO sessions (token_hash, user_id, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [tokenHash, userId, expiresAt, userAgent, ip]
  );
  return { token, expiresAt };
}

export async function findUserBySession(token) {
  if (!token || typeof token !== 'string') return null;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const { rows } = await query(
    `SELECT u.id, u.email, u.name, u.email_verified_at, u.created_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > NOW()
      LIMIT 1`,
    [tokenHash]
  );
  return rows[0] || null;
}

export async function deleteSession(token) {
  if (!token) return;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await query(`DELETE FROM sessions WHERE token_hash = $1`, [tokenHash]);
}

export async function deleteAllSessionsForUser(userId, exceptToken = null) {
  if (exceptToken) {
    const exceptHash = crypto.createHash('sha256').update(exceptToken).digest('hex');
    await query(`DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2`, [userId, exceptHash]);
  } else {
    await query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
  }
}

// ====================================================================
// USERS
// ====================================================================
export async function findUserByEmail(email) {
  const { rows } = await query(
    `SELECT id, email, name, password_hash, email_verified_at, created_at
       FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [email]
  );
  return rows[0] || null;
}

// Upsert: if email exists but is unverified, update with new name/password.
// If already verified, this is a no-op at the route level (the route checks first).
export async function createOrUpdateUser({ email, name, passwordHash }) {
  const { rows } = await query(
    `INSERT INTO users (email, name, password_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE
       SET name = EXCLUDED.name,
           password_hash = EXCLUDED.password_hash,
           updated_at = NOW()
     RETURNING id, email, name, created_at`,
    [email, name || null, passwordHash]
  );
  return rows[0];
}

export async function markEmailVerified(email) {
  await query(
    `UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()),
                       updated_at = NOW()
     WHERE LOWER(email) = LOWER($1)`,
    [email]
  );
}
