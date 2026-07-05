const Redis = require("ioredis");
const { REDIS_URL } = require("./env");

// BullMQ needs its own connection, separate from the app's regular cache
// client (src/config/redis.js) — it duplicates this connection internally
// for blocking commands, which requires maxRetriesPerRequest: null or
// BullMQ throws at startup.
const connection = REDIS_URL
  ? new Redis(REDIS_URL, {
      // maxRetriesPerRequest: null — REQUIRED by BullMQ. It runs blocking
      // commands (like waiting for a job); without this BullMQ crashes on retry.
      maxRetriesPerRequest: null,

      // enableReadyCheck: false — skips an extra "is server ready?" ping that
      // Upstash sometimes fails, which would otherwise throw false errors.
      enableReadyCheck: false,

      // keepAlive: 30000 — sends a small heartbeat every 30 seconds so Upstash
      // doesn't close the socket for being idle (the cause of your ECONNRESET).
      keepAlive: 30000,

      // retryStrategy — when the connection drops, reconnect after a delay that
      // grows each attempt (200ms, 400ms...) capped at 5s, instead of spamming
      // reconnects. `times` is how many attempts have happened so far.
      retryStrategy: (times) => Math.min(times * 200, 5000),
    })
  : null;

if (connection) {
  connection.on("error", (err) => console.error("BullMQ Redis error:", err.message));
}

module.exports = connection;