const Redis = require("ioredis");
const { REDIS_URL } = require("./env");

// If REDIS_URL is missing, cache becomes a no-op so the app still runs.
const redis = REDIS_URL ? new Redis(REDIS_URL, { lazyConnect: false }) : null;

if (redis) {
  redis.on("connect", () => console.log("Redis connected"));
  redis.on("error", (err) => console.error("Redis error:", err.message));
}

module.exports = redis;