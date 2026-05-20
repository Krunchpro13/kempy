# 🤖 KEMPY Backend v0.2

Node/Express backend for AI-powered Amazon → eBay product research. Now with **Redis caching** and a **Postgres watchlist**.

## Architecture

```
  ┌─────────┐     ┌──────────────────────────────────────────────┐
  │ Browser │────▶│  Express                                     │
  └─────────┘     │                                              │
                  │   ┌─────── Redis cache (3 layers) ───────┐  │
                  │   │  search:<q>     10 min                │  │
                  │   │  keepa:<q>      6 hours               │  │
                  │   │  claude:<hash>  7 days                │  │
                  │   └───────────────────────────────────────┘  │
                  │                                              │
                  │   /api/search → eBay → Keepa → Claude → ROI │
                  │   /api/watchlist  ─────────┐                 │
                  └───────────────────────────┬┘                 │
                                              ▼                  │
                                       ┌────────────────────────┘
                                       │  Postgres watchlist
                                       │  (saved products + price refresh)
                                       └─────
```

## Quickstart

```bash
npm install
npm start
```

That's it. Open **http://localhost:3000**. Page works on sample data, no keys needed.

To go live, fill in `.env` from `.env.example` — each setting unlocks a stage. Add what you have, restart, ship.

## Setup — incremental adoption

Every dependency is optional and detected at boot. The server boots in every combination of present/absent infrastructure. Recommended order:

| # | Add | Cost | Unlocks |
|---|-----|------|---------|
| 1 | `EBAY_CLIENT_ID` + `EBAY_CLIENT_SECRET` | free | Live eBay listings |
| 2 | `ANTHROPIC_API_KEY` | ~$0.001/match | Smart product matching |
| 3 | `KEEPA_API_KEY` | ~$20/mo | Real Amazon supplier prices |
| 4 | `REDIS_URL` | free local / free tier | Cuts API costs 60-90% |
| 5 | `DATABASE_URL` | free tier | Watchlist + price drift tracking |

After adding `DATABASE_URL`, run:
```bash
npm run migrate
```

### Local infrastructure with Docker

```bash
# Redis
docker run -d --name kempy-redis -p 6379:6379 redis:7-alpine

# Postgres
docker run -d --name kempy-pg -p 5432:5432 \
  -e POSTGRES_PASSWORD=kempy -e POSTGRES_DB=kempy postgres:16

# Then in .env:
# REDIS_URL=redis://localhost:6379
# DATABASE_URL=postgresql://postgres:kempy@localhost:5432/kempy
```

### Managed alternatives (both have free tiers)

- **Redis**: https://upstash.com (serverless, per-request billing)
- **Postgres**: https://neon.tech or https://supabase.com

## Cache layers explained

Every layer of the research pipeline is wrapped in cache with a TTL tuned to how often the underlying data changes:

| Layer | Key pattern | TTL | What it saves you |
|-------|-------------|-----|-------------------|
| Full response | `search:<query>` | 10 min | Everything — short-circuits the whole pipeline |
| Keepa candidates | `keepa:<query>` | 6 hours | Keepa tokens (real $) |
| Claude decisions | `claude:<sha1>` | 7 days | Anthropic tokens (real $) |

The Claude decision cache is keyed by `sha1(eBay title + sorted ASIN set)` — so the same eBay listing matched against the same candidate set always returns the cached decision, regardless of candidate order from Keepa.

### Cost reduction example

100 queries to "wireless headphones" in a day:
- **Without cache**: 100 × ($0.007 Claude + 9 Keepa tokens) = real money
- **With cache**: 1 × ($0.007 + 9 tokens) + 99 cache hits ≈ free

The `/api/health` endpoint surfaces hit rates so you can verify it's working:
```json
{
  "cache": {
    "enabled": true,
    "hitRate": { "search": 87, "keepa": 92, "claude": 95 }
  }
}
```

## Watchlist

The watchlist is a Postgres-backed table of researched products. Click ⭐ Save on any research card. The watchlist panel lets you:

- See all saved products with original snapshot (price, profit, ROI)
- Refresh prices to detect drift (button calls Keepa for each saved ASIN)
- Drift indicator on each row: ROI delta vs initial save
- Delete items you no longer track

### Schema

```sql
watchlist (
  id              SERIAL PRIMARY KEY,
  ebay_title      TEXT NOT NULL,
  ebay_url, asin, amazon_url,
  initial_*_price, initial_profit, initial_roi,    -- snapshot at save time
  latest_*_price, latest_profit, latest_roi,        -- last refresh values
  last_refreshed_at,
  category, match_source, match_confidence,
  verdict_label, notes,
  created_at, updated_at
);
-- partial unique index prevents duplicate ASIN saves
-- updated_at trigger keeps timestamps honest
```

## API

### `GET /api/health`
```json
{
  "status": "ok",
  "sources": { "ebay": "live", "amazon": "live", "matcher": "claude" },
  "cache": {
    "enabled": true,
    "hits":   { "search": 87, "keepa": 12, "claude": 8 },
    "misses": { "search": 13, "keepa": 4,  "claude": 2 },
    "hitRate":{ "search": 87, "keepa": 75, "claude": 80 },
    "errors": 0
  },
  "db": { "ok": true }
}
```

### `GET /api/search?q=<keyword>`

Returns ranked product opportunities. `meta.cached: true` when served from Redis.

### `POST /api/watchlist`

Body: `{ name, ebayPrice, amazonPrice?, profit?, roi?, asin?, ... }`
Returns: the inserted row, or **409** if ASIN already saved.

### `GET /api/watchlist`

Returns `{ items, count }` ordered by `created_at DESC`, max 100.

### `DELETE /api/watchlist/:id`

Returns `{ ok: true }` or **404**.

### `POST /api/watchlist/refresh`

Re-queries Keepa for every saved item, updates `latest_*` columns. Returns `{ refreshed, skipped, total }`.

## Project layout

```
kempy-backend/
├── server.js                       Express app entry point
├── test-matcher.js                 CLI test for the Claude matcher
├── package.json
├── .env.example                    Copy to .env
├── public/
│   └── index.html                  KEMPY frontend (Save buttons, watchlist view)
└── src/
    ├── migrate.js                  Run schema.sql (npm run migrate)
    ├── schema.sql                  Postgres schema
    ├── routes/
    │   └── watchlist.js            /api/watchlist routes
    └── services/
        ├── research.js             Orchestrator — eBay → Amazon → Claude → profit
        ├── ebay.js                 eBay Browse API + OAuth caching
        ├── amazon.js               Keepa API (cached)
        ├── claude.js               Claude Haiku 4.5 matcher (cached)
        ├── profit.js               12.9% fee math, ROI, verdict
        ├── cache.js                Redis with hit/miss tracking
        ├── db.js                   Postgres pool
        ├── watchlist.js            Watchlist CRUD + refresh logic
        └── fallback-data.js        Mock products when no API keys set
```

## Known limitations & next moves

| Limitation | Fix |
|-----------|-----|
| Single-user (no auth) | Add JWT/session middleware + `user_id` column on watchlist |
| eBay Browse returns active listings only | Apply for Marketplace Insights API |
| Refresh hits Keepa serially | Parallelize with `Promise.allSettled` + concurrency cap |
| No scheduled refresh | Add a cron job or `node-cron` worker |
| Watchlist has no notes/tags filtering | Add tag column + filter UI |
| No bulk export | Add CSV export endpoint for tax-time accounting |

## Production deployment notes

- Set `NODE_ENV=production`, run behind nginx/Caddy.
- Add `express-rate-limit` on `/api/search` and `/api/watchlist`.
- Cache stats are per-process — for HA, scrape `/api/health` into Prometheus.
- The eBay token cache is in-memory; for multi-instance, move to Redis (it's already there).
- Connection pools are sized for ~10 concurrent DB ops; tune `pg.Pool({ max })` for your load.

## License

MIT.
