import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { sessionMiddleware } from './src/middleware/auth.js';
import { notFound, errorHandler } from './src/middleware/error.js';
import { searchProducts } from './src/services/research.js';
import { initCache, isEnabled as cacheEnabled, getStats as cacheStats } from './src/services/cache.js';
import { initDb, isEnabled as dbEnabled, ping as dbPing } from './src/services/db.js';

import authRouter from './src/routes/auth.js';
import watchlistRouter from './src/routes/watchlist.js';
import settingsRouter from './src/routes/settings.js';
import listingsRouter from './src/routes/listings.js';
import ordersRouter from './src/routes/orders.js';
import profitRouter from './src/routes/profit.js';
import ebayRouter from './src/routes/ebay.js';
import ebayListingsRouter from './src/routes/ebay-listings.js';
import { isConfigured as ebaySellerConfigured } from './src/services/ebay-oauth.js';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// Behind Railway's proxy: trust it so req.ip / rate-limiting see the real client.
app.set('trust proxy', 1);

// ---- Security & parsing ----
// CSP is disabled because pages use inline styles/scripts; the other helmet
// headers (HSTS, nosniff, frameguard, etc.) still apply.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(sessionMiddleware);

// ---- Static frontend ----
app.use(express.static(join(__dirname, 'public')));

// ---- Rate limiting (per IP, in-memory) ----
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});
app.use('/api', apiLimiter);
app.use('/api/auth', authLimiter);

// ---- Boot infrastructure ----
await initCache();
initDb();

// ---- Health ----
app.get('/api/health', async (_req, res, next) => {
  try {
    const db = await dbPing();
    res.json({
      status: 'ok',
      sources: {
        ebay: process.env.EBAY_CLIENT_ID ? 'live' : 'mock',
        amazon: process.env.KEEPA_API_KEY ? 'live (Keepa)' : 'mock',
        matcher: process.env.ANTHROPIC_API_KEY ? 'claude' : 'first-result',
        ebaySeller: ebaySellerConfigured() ? 'configured' : 'not configured',
      },
      cache: cacheStats(),
      db,
    });
  } catch (err) { next(err); }
});

// ---- Search ----
app.get('/api/search', async (req, res, next) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ products: [], meta: { query: q, count: 0 } });
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
  } catch (err) { next(err); }
});

// ---- API routes ----
app.use('/api/auth', authRouter);
app.use('/api/watchlist', watchlistRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/listings', listingsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/profit', profitRouter);
app.use('/api/ebay', ebayRouter);
app.use('/api/ebay', ebayListingsRouter);

// ---- 404 (API) + error handler — must be last ----
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  🤖  KEMPY running on http://localhost:${PORT}\n`);
  console.log(`  eBay:     ${process.env.EBAY_CLIENT_ID ? '✓ live' : '○ mock'}`);
  console.log(`  Amazon:   ${process.env.KEEPA_API_KEY ? '✓ live (Keepa)' : '○ mock'}`);
  console.log(`  Matcher:  ${process.env.ANTHROPIC_API_KEY ? '✓ Claude' : '○ first-result'}`);
  console.log(`  Cache:    ${cacheEnabled() ? '✓ Redis' : '○ disabled'}`);
  console.log(`  Database: ${dbEnabled() ? '✓ Postgres' : '○ disabled'}`);
  console.log(`  eBay sell:${ebaySellerConfigured() ? ' ✓ OAuth ready' : ' ○ not configured'}\n`);
});
