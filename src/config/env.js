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
 * CLOUDINARY_CLOUD_NAME=<from Cloudinary dashboard>
 * CLOUDINARY_API_KEY=<from Cloudinary dashboard>
 * CLOUDINARY_API_SECRET=<from Cloudinary dashboard — never sent to frontend>
 * FRONTEND_URL=<the deployed frontend's origin, e.g. https://app.example.com — optional, defaults to the local Vite dev server>
 * RESEND_API_KEY=<from resend.com dashboard → API Keys — used to send real emails in production>
 * EMAIL_TEST_RECIPIENT=<TEMPORARY, for testing only — while Resend is in sandbox
 *   mode (no verified domain yet), it only allows sending to the address your
 *   Resend account is registered under. Set this to that address and every
 *   outgoing email gets redirected to it, no matter who the real recipient
 *   was. Remove this line once a domain is verified, to go back to sending
 *   to real recipients.>
 */


module.exports = {
  PORT: process.env.PORT || 5000,
  // The ONLY origin allowed to call this API with credentials (see app.js's
  // cors() setup). Must be set to the real deployed frontend URL in
  // production — the localhost fallback only works for local development.
  FRONTEND_URL: process.env.FRONTEND_URL || "http://localhost:3000",
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
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  EMAIL_FROM: process.env.EMAIL_FROM,
  // TEMPORARY — see the comment above this file's env-var list. undefined
  // (not set) means "off": emails go to their real recipient as normal.
  EMAIL_TEST_RECIPIENT: process.env.EMAIL_TEST_RECIPIENT || null,
};

