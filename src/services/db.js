// =============================================================================
// Postgres pool
// =============================================================================
// Single shared pg.Pool instance. If DATABASE_URL is missing, isEnabled()
// returns false and watchlist routes return a clear 503 — the rest of the
// app keeps running.
// =============================================================================

import pg from 'pg';

let pool = null;

export function initDb() {
  if (!process.env.DATABASE_URL) return null;
  if (pool) return pool;

  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  pool.on('error', (err) => {
    console.error('[db] pool error:', err.message);
  });

  return pool;
}

export function isEnabled() {
  return pool !== null;
}

export function getPool() {
  return pool;
}

export async function query(text, params) {
  if (!pool) throw new Error('Database not configured (DATABASE_URL missing)');
  return pool.query(text, params);
}

export async function ping() {
  if (!pool) return { ok: false, reason: 'not configured' };
  try {
    const { rows } = await pool.query('SELECT 1 AS ok');
    return { ok: rows[0].ok === 1 };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}
