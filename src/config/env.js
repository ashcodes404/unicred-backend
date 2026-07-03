require("dotenv").config();


/**
 * ENV CONFIG
 * Centralizes access to environment variables so the rest of the app
 * never calls process.env directly (easier to manage + validate).
 *
 * Add these to your .env file:
 *
 * JWT_ACCESS_SECRET=<a long random string, e.g. from `openssl rand -hex 64`>
 * JWT_ACCESS_EXPIRES_IN=15m
 * REFRESH_TOKEN_EXPIRES_DAYS=7
 */


module.exports = {
  PORT: process.env.PORT || 5001,
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
  REFRESH_TOKEN_EXPIRES_DAYS: Number(process.env.REFRESH_TOKEN_EXPIRES_DAYS) || 7,
  REDIS_URL: process.env.REDIS_URL,
  CACHE_TTL_SECONDS: Number(process.env.CACHE_TTL_SECONDS) || 300,
};

