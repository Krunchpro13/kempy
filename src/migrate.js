// =============================================================================
// Migration runner
// =============================================================================
// Usage: npm run migrate
// Idempotent — safe to re-run. Just executes schema.sql.
// =============================================================================

import 'dotenv/config';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initDb, query } from './services/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function run() {
  if (!process.env.DATABASE_URL) {
    console.error('✗ DATABASE_URL not set. Add it to .env.');
    console.error('  Example: postgresql://user:pass@localhost:5432/kempy');
    process.exit(1);
  }

  initDb();

  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');

  console.log('▸ Running migration...');
  try {
    await query(sql);
    console.log('✓ Migration complete.');
    console.log('');
    console.log('  Tables: watchlist');
    console.log('  Indexes: watchlist_asin_unique, watchlist_created_idx');
    console.log('  Triggers: watchlist_updated_at');
  } catch (err) {
    console.error('✗ Migration failed:', err.message);
    process.exit(1);
  }

  process.exit(0);
}

run();
