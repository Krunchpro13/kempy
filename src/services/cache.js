// =============================================================================
// Redis cache service
// =============================================================================
// Three independent cache layers, all coordinated through this module:
//
//   1. search:<query>      → full /api/search response  (TTL 10 min)
//   2. keepa:<query>       → Amazon candidate list      (TTL 6 hours)
//   3. claude:<hash>       → Claude match decision      (TTL 7 days)
//
// Graceful degradation: if REDIS_URL isn't set, every operation no-ops and
// the rest of the system runs normally. Code at call sites looks identical.
//
// Hit/miss counters are tracked in memory for /api/health to surface.
// =============================================================================

import { createClient } from 'redis';
import crypto from 'crypto';

let client = null;
let connecting = null;

const stats = {
  hits: { search: 0, keepa: 0, claude: 0 },
  misses: { search: 0, keepa: 0, claude: 0 },
  errors: 0,
};

export const TTL = {
  SEARCH: 60 * 10,           // 10 minutes
  KEEPA: 60 * 60 * 6,        // 6 hours
  CLAUDE: 60 * 60 * 24 * 7,  // 7 days
};

/**
 * Initialise the Redis client. Idempotent. Called at server boot.
 * If REDIS_URL is missing the function resolves immediately with null
 * and every cache op below becomes a no-op.
 */
export async function initCache() {
  if (!process.env.REDIS_URL) return null;
  if (client) return client;
  if (connecting) return connecting;

  connecting = (async () => {
    const c = createClient({ url: process.env.REDIS_URL });
    c.on('error', (err) => {
      // Don't spam the console — once is enough to know it's down
      if (stats.errors === 0) console.error('[cache] Redis error:', err.message);
      stats.errors += 1;
    });
    try {
      await c.connect();
      client = c;
      console.log('[cache] connected to Redis');
      return c;
    } catch (err) {
      console.error('[cache] Redis connect failed, running without cache:', err.message);
      client = null;
      return null;
    }
  })();

  return connecting;
}

export function isEnabled() {
  return client !== null;
}

export function getStats() {
  const totals = (kind) => stats.hits[kind] + stats.misses[kind];
  const rate = (kind) => {
    const t = totals(kind);
    return t === 0 ? null : Math.round((stats.hits[kind] / t) * 100);
  };
  return {
    enabled: isEnabled(),
    hits: { ...stats.hits },
    misses: { ...stats.misses },
    hitRate: {
      search: rate('search'),
      keepa: rate('keepa'),
      claude: rate('claude'),
    },
    errors: stats.errors,
  };
}

// ---- Internal helpers ----

async function rawGet(key, kind) {
  if (!client) return null;
  try {
    const v = await client.get(key);
    if (v) {
      stats.hits[kind] += 1;
      return JSON.parse(v);
    }
    stats.misses[kind] += 1;
    return null;
  } catch (err) {
    stats.errors += 1;
    return null;
  }
}

async function rawSet(key, value, ttl) {
  if (!client) return;
  try {
    await client.set(key, JSON.stringify(value), { EX: ttl });
  } catch (err) {
    stats.errors += 1;
  }
}

function normalize(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// ---- Layer 1: full search response ----

export async function getCachedSearch(query) {
  const key = `search:${normalize(query)}`;
  return rawGet(key, 'search');
}

export async function setCachedSearch(query, payload) {
  const key = `search:${normalize(query)}`;
  return rawSet(key, payload, TTL.SEARCH);
}

// ---- Layer 2: Keepa Amazon candidates ----

export async function getCachedKeepa(query) {
  const key = `keepa:${normalize(query)}`;
  return rawGet(key, 'keepa');
}

export async function setCachedKeepa(query, candidates) {
  const key = `keepa:${normalize(query)}`;
  return rawSet(key, candidates, TTL.KEEPA);
}

// ---- Layer 3: Claude match decisions ----
// Keyed by (eBay title + sorted ASIN set) so the same listing matched against
// the same candidate set always returns the same cached decision.

export async function getCachedMatch(ebayTitle, candidates) {
  const key = matchKey(ebayTitle, candidates);
  return rawGet(key, 'claude');
}

export async function setCachedMatch(ebayTitle, candidates, decision) {
  const key = matchKey(ebayTitle, candidates);
  return rawSet(key, decision, TTL.CLAUDE);
}

function matchKey(ebayTitle, candidates) {
  const asins = candidates.map((c) => c.asin).sort().join(',');
  const h = crypto
    .createHash('sha1')
    .update(normalize(ebayTitle) + '|' + asins)
    .digest('hex')
    .slice(0, 16);
  return `claude:${h}`;
}
