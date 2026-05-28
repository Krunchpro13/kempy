// src/migrate.js
//
// Run with: npm run migrate
// Reads src/schema.sql and applies it against DATABASE_URL.
// Safe to re-run — every statement uses CREATE TABLE IF NOT EXISTS.

import './env.js';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('✗ DATABASE_URL not set in .env');
    console.error('  Get a free Postgres URL from https://neon.tech, then add to .env.');
    process.exit(1);
  }

  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');

  // Neon (and most cloud Postgres) need explicit ssl config alongside ?sslmode=require
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  console.log('▸ Connecting to database...');
  try {
    const start = Date.now();
    await pool.query(sql);
    console.log(`✓ Schema applied (${Date.now() - start}ms)`);

    const { rows } = await pool.query(`
      SELECT table_name,
             (SELECT COUNT(*) FROM information_schema.columns
              WHERE table_name = t.table_name AND table_schema = 'public') AS columns
      FROM information_schema.tables t
      WHERE table_schema = 'public' AND table_name IN ('users', 'sessions', 'otp_codes')
      ORDER BY table_name
    `);
    console.log('\n  Tables ready:');
    for (const r of rows) {
      console.log(`    • ${r.table_name} (${r.columns} columns)`);
    }
    console.log('\n✓ Database is ready. Run `npm start`.');
  } catch (err) {
    console.error('\n✗ Migration failed:', err.message);
    if (err.message.includes('SSL') || err.message.includes('certificate')) {
      console.error('  Hint: confirm your DATABASE_URL ends with ?sslmode=require');
    }
    if (err.message.includes('ENOTFOUND') || err.message.includes('getaddrinfo')) {
      console.error('  Hint: hostname in DATABASE_URL looks wrong. Re-copy it from Neon.');
    }
    if (err.message.includes('password authentication')) {
      console.error('  Hint: the password in DATABASE_URL is wrong. Re-copy it from Neon.');
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
