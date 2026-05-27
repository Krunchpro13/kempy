import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { searchEbay } from './src/services/ebay.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { searchProducts } from './src/services/research.js';
import { initCache, isEnabled as cacheEnabled, getStats as cacheStats } from './src/services/cache.js';
import { initDb, isEnabled as dbEnabled, ping as dbPing } from './src/services/db.js';
import watchlistRouter from './src/routes/watchlist.js';
import listingsRouter from './src/routes/listings.js';
import ordersRouter from './src/routes/orders.js';
import profitRouter from './src/routes/profit.js';
import storesRouter from './src/routes/stores.js';
import teamRouter from './src/routes/team.js';
import settingsRouter from './src/routes/settings.js';
import billingRouter from './src/routes/billing.js';
import affiliateRouter from './src/routes/affiliate.js';
import staffRouter from './src/routes/staff.js';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Boot infrastructure
await initCache();
initDb();

// Health check — surfaces everything so you can debug quickly
app.get('/api/health', async (req, res) => {
  const db = await dbPing();
  res.json({
    status: 'ok',
    sources: {
      ebay: process.env.EBAY_CLIENT_ID ? 'live' : 'mock',
      amazon: process.env.KEEPA_API_KEY ? 'live (Keepa)' : 'mock',
      matcher: process.env.ANTHROPIC_API_KEY ? 'claude' : 'first-result',
    },
    cache: cacheStats(),
    db,
  });
});

// Main search endpoint
app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) {
    return res.json({ products: [], meta: { query: q, count: 0 } });
  }

  try {
    const start = Date.now();
    const { products, cached } = await searchProducts(q);
    res.json({
      products,
      meta: {
        query: q,
        count: products.length,
        ms: Date.now() - start,
        cached,
        sources: {
          ebay: process.env.EBAY_CLIENT_ID ? 'live' : 'mock',
          amazon: process.env.KEEPA_API_KEY ? 'live' : 'mock',
          matcher: process.env.ANTHROPIC_API_KEY ? 'claude' : 'first-result',
        },
      },
    });
  } catch (err) {
    console.error('[search] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Watchlist
app.use('/api/watchlist', watchlistRouter);

// Listings
app.use('/api/listings', listingsRouter);

// Orders
app.use('/api/orders', ordersRouter);

// New Pages
app.use('/api/profit', profitRouter);
app.use('/api/stores', storesRouter);
app.use('/api/team', teamRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/billing', billingRouter);
app.use('/api/affiliate', affiliateRouter);
app.use('/api/staff', staffRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║   🤖  KEMPY backend running              ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');
  console.log(`  ▸ Frontend:   http://localhost:${PORT}`);
  console.log(`  ▸ Health:     http://localhost:${PORT}/api/health`);
  console.log(`  ▸ Search:     http://localhost:${PORT}/api/search?q=headphones`);
  console.log(`  ▸ Watchlist:  http://localhost:${PORT}/api/watchlist`);
  console.log(`  ▸ Listings:   http://localhost:${PORT}/api/listings`);
  console.log(`  ▸ Orders:     http://localhost:${PORT}/api/orders`);
  console.log('');
  console.log(`  eBay:      ${process.env.EBAY_CLIENT_ID ? '✓ live' : '○ mock (set EBAY_CLIENT_ID)'}`);
  console.log(`  Amazon:    ${process.env.KEEPA_API_KEY ? '✓ live (Keepa)' : '○ mock (set KEEPA_API_KEY)'}`);
  console.log(`  Matcher:   ${process.env.ANTHROPIC_API_KEY ? '✓ Claude Haiku 4.5' : '○ first-result (set ANTHROPIC_API_KEY)'}`);
  console.log(`  Cache:     ${cacheEnabled() ? '✓ Redis' : '○ disabled (set REDIS_URL)'}`);
  console.log(`  Database:  ${dbEnabled() ? '✓ Postgres' : '○ disabled (set DATABASE_URL, then npm run migrate)'}`);
  console.log('');
});
