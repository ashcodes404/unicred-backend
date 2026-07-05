const redis = require("../config/redis");
const { CACHE_TTL_SECONDS } = require("../config/env");

// Wrap any async DB read. Returns cached value or fetches + stores it.
//
// `tag` groups related keys (e.g. "dept:5") so they can all be dropped in one
// O(1) call via invalidate(tag) — no KEYS/SCAN over the keyspace required.
// Every key written under a tag is tracked in a Redis Set at `tagset:<tag>`.
async function cached(key, ttl, fetchFn, tag) {
  if (!redis) return fetchFn();               // no Redis → just hit DB
  try {
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit);
  } catch (_) { /* ignore cache read errors */ }

  const data = await fetchFn();
  redis.set(key, JSON.stringify(data), "EX", ttl || CACHE_TTL_SECONDS)
       .catch(() => {});                       // fire-and-forget write

  if (tag) {
    redis.sadd(`tagset:${tag}`, key).catch(() => {});
  }

  return data;
}

// Drop every key ever cached under `tag`, in O(1) — reads the tag's key set
// and deletes those keys plus the set itself, instead of scanning the keyspace.
async function invalidate(tag) {
  if (!redis) return;
  const tagKey = `tagset:${tag}`;
  const keys = await redis.smembers(tagKey);
  if (keys.length) await redis.del(...keys, tagKey);
  else await redis.del(tagKey);
}

module.exports = { cached, invalidate };
