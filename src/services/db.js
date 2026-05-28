// src/services/db.js
//
// Postgres connection pool. Lights up when DATABASE_URL is set;
// otherwise degrades gracefully (callers check isEnabled()).

import pg from 'pg';

let pool = null;
let enabled = false;

export function initDb() {
  if (!process.env.DATABASE_URL) {
    enabled = false;
    return;
  }
  try {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },     // Neon, Supabase, RDS — all want this
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
    });
    pool.on('error', (err) => {
      console.error('[db] idle client error:', err.message);
    });
    enabled = true;
  } catch (err) {
    console.error('[db] failed to initialize:', err.message);
    enabled = false;
  }
}

export function isEnabled() {
  return enabled;
}

export async function ping() {
  if (!enabled || !pool) return { ok: false, reason: 'DATABASE_URL not set' };
  try {
    const r = await pool.query('SELECT 1 AS ok');
    return { ok: r.rows[0].ok === 1 };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

export async function query(text, params) {
  if (!enabled || !pool) {
    throw new Error('Database not configured. Set DATABASE_URL and run npm run migrate.');
  }
  return pool.query(text, params);
}

export function getPool() {
  return pool;
}

// Convenience transaction helper — pass in a function that gets a client.
export async function withTransaction(fn) {
  if (!enabled || !pool) throw new Error('Database not configured');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
