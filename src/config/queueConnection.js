const Redis = require("ioredis");
const { REDIS_URL } = require("./env");

// BullMQ needs its own connection, separate from the app's regular cache
// client (src/config/redis.js) — it duplicates this connection internally
// for blocking commands, which requires maxRetriesPerRequest: null or
// BullMQ throws at startup.
const connection = REDIS_URL
  ? new Redis(REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false })
  : null;

if (connection) {
  connection.on("error", (err) => console.error("BullMQ Redis error:", err.message));
}

module.exports = connection;
