// src/services/crypto.js
//
// Tiny AES-256-GCM helper for encrypting secrets at rest (eBay refresh tokens).
//
// We never store an eBay refresh token in plaintext: a DB leak alone must not
// hand an attacker 18 months of access to a user's eBay store. The encryption
// key lives ONLY in the ENCRYPTION_KEY env var (Railway), never in the repo.
//
// Ciphertext format: "ivB64:tagB64:dataB64" — self-describing, so we don't need
// separate columns for the IV / auth tag.
//
// IMPORTANT: do not rotate ENCRYPTION_KEY once tokens are stored — old tokens
// would become undecryptable and every user would have to reconnect.

import crypto from 'crypto';

function key() {
  const k = process.env.ENCRYPTION_KEY;
  if (!k) throw new Error('ENCRYPTION_KEY not set');
  // Accept a 64-hex-char (32-byte) key directly; otherwise hash whatever is
  // given down to a stable 32 bytes so any sufficiently-random string works.
  return k.length === 64 && /^[0-9a-fA-F]+$/.test(k)
    ? Buffer.from(k, 'hex')
    : crypto.createHash('sha256').update(k).digest();
}

export function isConfigured() {
  return !!process.env.ENCRYPTION_KEY;
}

export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, data].map(b => b.toString('base64')).join(':');
}

export function decrypt(blob) {
  const [iv, tag, data] = String(blob).split(':').map(s => Buffer.from(s, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
