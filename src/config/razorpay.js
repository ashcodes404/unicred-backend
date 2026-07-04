/**
 * RAZORPAY CLIENT CONFIG
 * =======================
 * The "razorpay" npm package is Razorpay's official Node.js SDK — it wraps
 * their REST API (creating orders, verifying payments, etc.) so we don't
 * have to hand-write HTTP calls + auth headers ourselves.
 *
 * WHY ONE SHARED INSTANCE (not `new Razorpay()` inside every request handler):
 *   - The constructor just stores the key_id/key_secret in memory — it doesn't
 *     open a network connection, so there's no per-request cost saved, but
 *     creating a new object on every request is still wasteful garbage-collector
 *     churn for zero benefit.
 *   - One instance = one place to swap test/live keys later.
 *   - Matches how other shared clients in this project are set up (e.g.
 *     src/config/db.js exports a single PrismaClient instance).
 *
 * Currently running in TEST MODE — RAZORPAY_KEY_ID starts with "rzp_test_".
 * Swap to live keys in .env when ready to accept real payments (Phase 3+).
 */

const Razorpay = require("razorpay");
const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } = require("./env");

// razorpay.orders.create(), used in Phase 2, and razorpay.payments.fetch()
// (needed in Phase 3) are both called through this one client instance.
const razorpay = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET,
});

module.exports = razorpay;
