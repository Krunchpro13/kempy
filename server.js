import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

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
import billingRouter from './src/routes/billing.js';
import * as billing from './src/services/billing.js';
import { requireSubscription } from './src/middleware/subscription.js';
import { isConfigured as ebaySellerConfigured } from './src/services/ebay-oauth.js';
import { renderSidebar } from './src/views/sidebar.js';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// Behind Railway's proxy: trust it so req.ip / rate-limiting see the real client.
app.set('trust proxy', 1);

// ---- Security & parsing ----
// Content-Security-Policy tuned for this zero-build app: all scripts/styles are
// same-origin or inline (no external JS), fonts come from Google Fonts, product
// images come from arbitrary https CDNs, and every API call is same-origin.
// 'unsafe-inline' is required because pages use inline <script>/<style>.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      // Inline event-handler attributes (e.g. <img onerror="this.remove()">) are
      // used for image fallbacks — allow them so CSP doesn't silently break those.
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// CORS: the frontend is served same-origin, so cross-origin access is only ever
// our own domain (+ localhost for dev). Lock it down instead of reflecting any origin.
const ALLOWED_ORIGINS = [
  process.env.APP_URL || 'https://kempzonline.com',
  'http://localhost:3000',
];
app.use(cors({
  origin(origin, cb) {
    // Same-origin / curl / server-to-server requests send no Origin header → allow.
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: true,
}));

// ---- Stripe webhook (MUST be before express.json so the raw body survives for
// signature verification). The webhook is unauthenticated (verified by signature). ----
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!billing.isEnabled()) return res.status(503).end();
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = billing.constructEvent(req.body, sig);
  } catch (err) {
    console.error('[stripe] webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  try {
    await billing.handleWebhookEvent(event);
  } catch (err) {
    console.error('[stripe] webhook handler error:', err.message);
  }
  res.json({ received: true });
});

app.use(express.json({ limit: '1mb' }));
app.use(sessionMiddleware);

// ---- App pages: inject the shared sidebar partial ----
// /app/<page>.html is served with its `<!--SIDEBAR-->` marker replaced by the
// single shared sidebar (src/views/sidebar.js). Falls through to static serving
// if the file is missing or hasn't been migrated to use the marker.
app.get(/^\/app\/([a-z0-9-]+)\.html$/, (req, res, next) => {
  const page = req.params[0];
  let html;
  try {
    html = readFileSync(join(__dirname, 'public', 'app', `${page}.html`), 'utf8');
  } catch (_) {
    return next(); // unknown page → let static/404 handle it
  }
  if (!html.includes('<!--SIDEBAR-->')) return next(); // not migrated → serve as-is
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.type('html').send(html.replace('<!--SIDEBAR-->', renderSidebar(page, req.user)));
});

// ---- Static frontend ----
// HTML must always be revalidated so users pick up the latest app JS immediately
// (otherwise a cached page can keep running stale logic). Other assets cache normally.
app.use(express.static(join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));

// ---- Rate limiting (per IP, in-memory) ----
// In-memory keeps every /api request fast (no per-request network hop). A shared
// store across instances was tried but added ~3 Redis round-trips to each API
// call; not worth the latency at this scale.
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

// ---- Never cache API responses ----
// Auth-dependent JSON (e.g. /api/listings, /api/orders, /api/ebay/status) must
// never be served stale from the browser cache — otherwise a "connected:false"
// from one account can survive an account switch. Disable ETag/conditional GETs
// and force no-store on every /api response.
app.set('etag', false);
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
});

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
        billing: billing.isEnabled() ? 'configured' : 'not configured',
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
// Money features require an active subscription (freemium gate; fails open if Stripe unset).
app.use('/api/listings', requireSubscription, listingsRouter);
app.use('/api/orders', requireSubscription, ordersRouter);
app.use('/api/profit', requireSubscription, profitRouter);
app.use('/api/ebay', ebayRouter);
app.use('/api/ebay', ebayListingsRouter);
app.use('/api/billing', billingRouter);

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
  console.log(`  eBay sell:${ebaySellerConfigured() ? ' ✓ OAuth ready' : ' ○ not configured'}`);
  console.log(`  Billing:  ${billing.isEnabled() ? '✓ Stripe' : '○ not configured'}\n`);
});
