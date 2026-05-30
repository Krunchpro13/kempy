// src/middleware/rate-store.js
//
// A Redis-backed store for express-rate-limit so limits are shared across
// multiple app instances (Railway can run more than one). Uses the SAME Redis
// connection as the cache layer.
//
// FAIL-OPEN by design: if Redis is unavailable or errors, a request is allowed
// rather than blocked — a rate limiter should never take down the whole API.
// When Redis isn't configured at all, server.js falls back to the library's
// default in-memory store instead of using this.

import { getClient } from '../services/cache.js';

export class RedisRateStore {
  constructor(prefix = 'rl:') {
    this.prefix = prefix;
    this.windowMs = 60_000;
  }

  // express-rate-limit calls this with the resolved options at mount time.
  init(options) {
    this.windowMs = options.windowMs;
  }

  async increment(key) {
    const fresh = { totalHits: 1, resetTime: new Date(Date.now() + this.windowMs) };
    const client = getClient();
    if (!client) return fresh; // Redis down → fail open
    try {
      const k = this.prefix + key;
      const hits = await client.incr(k);
      if (hits === 1) await client.pExpire(k, this.windowMs);
      let ttl = await client.pTTL(k);
      if (ttl < 0) ttl = this.windowMs; // key with no expiry → reset the window
      return { totalHits: hits, resetTime: new Date(Date.now() + ttl) };
    } catch (_) {
      return fresh; // any Redis error → fail open
    }
  }

  async decrement(key) {
    const client = getClient();
    if (!client) return;
    try { await client.decr(this.prefix + key); } catch (_) { /* ignore */ }
  }

  async resetKey(key) {
    const client = getClient();
    if (!client) return;
    try { await client.del(this.prefix + key); } catch (_) { /* ignore */ }
  }
}
