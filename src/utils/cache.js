const redis = require("../config/redis");
const { CACHE_TTL_SECONDS } = require("../config/env");

// Wrap any async DB read. Returns cached value or fetches + stores it.
async function cached(key, ttl, fetchFn) {
  if (!redis) return fetchFn();               // no Redis → just hit DB
  try {
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit);
  } catch (_) { /* ignore cache read errors */ }

  const data = await fetchFn();
  redis.set(key, JSON.stringify(data), "EX", ttl || CACHE_TTL_SECONDS)
       .catch(() => {});                       // fire-and-forget write
  return data;
}

// Call after writes to drop stale entries (supports "courses:*" patterns).
async function invalidate(pattern) {
  if (!redis) return;
  const keys = await redis.keys(pattern);
  if (keys.length) await redis.del(keys);
}

module.exports = { cached, invalidate };