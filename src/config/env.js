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
 * RAZORPAY_KEY_ID=<from Razorpay dashboard, test mode>
 * RAZORPAY_KEY_SECRET=<from Razorpay dashboard, test mode — never sent to frontend>
 * RAZORPAY_WEBHOOK_SECRET=<from Razorpay dashboard → Webhooks — separate from RAZORPAY_KEY_SECRET>
 * LOGIN_URL=<frontend login page, e.g. https://app.example.com/login — optional, defaults to "/login">
 * GST_RATE=<total GST %, e.g. 18 — optional, defaults to 18>
 * GST_SELLER_GSTIN=<our company's GSTIN — optional, leave blank until registered for GST>
 */


module.exports = {
  PORT: process.env.PORT || 5000,
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
  REFRESH_TOKEN_EXPIRES_DAYS: Number(process.env.REFRESH_TOKEN_EXPIRES_DAYS) || 7,
  REDIS_URL: process.env.REDIS_URL,
  CACHE_TTL_SECONDS: Number(process.env.CACHE_TTL_SECONDS) || 300,
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET,
  LOGIN_URL: process.env.LOGIN_URL || "/login",
  GST_RATE: Number(process.env.GST_RATE) || 18,
  GST_SELLER_GSTIN: process.env.GST_SELLER_GSTIN || null,
};

