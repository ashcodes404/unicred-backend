// =============================================================================
// SUBSCRIPTION RENEWAL ROUTES — PHASE 8C
// =============================================================================
// Mounted at /api/admin/subscription in routes/index.js.
//
//   GET  /api/admin/subscription              — this admin's school: status/expiry/plan
//   POST /api/admin/subscription/renew-order  — create a one-time Razorpay renewal order
//   POST /api/admin/subscription/renew-verify — verify payment, extend subscription
//
// All 3 routes are admin-only (authenticate + requireRole("admin"), reused
// as-is — no new auth logic). They are ALSO the exact allowlist that
// subscriptionGate.middleware.js lets an admin of an EXPIRED school reach —
// see that file for the other side of this relationship.
// =============================================================================

const express = require("express");
const router = express.Router();

const {
  getStatusHandler,
  renewOrderHandler,
  renewVerifyHandler,
  getHistoryHandler,
} = require("./subscription.controller");

const authenticate = require("../../middleware/auth.middleware");
const requireRole = require("../../middleware/role.middleware");

// Reused as-is from registration's rate limiters — same "money-sensitive,
// must resist abuse" tiers, just applied to a different route.
const {
  registrationReadRateLimiter,
  registrationPaymentRateLimiter,
} = require("../../middleware/rateLimit.middleware");

router.get("/", authenticate, requireRole("admin"), registrationReadRateLimiter, getStatusHandler);
router.get("/history", authenticate, requireRole("admin"), registrationReadRateLimiter, getHistoryHandler);
router.post("/renew-order", authenticate, requireRole("admin"), registrationPaymentRateLimiter, renewOrderHandler);
router.post("/renew-verify", authenticate, requireRole("admin"), registrationPaymentRateLimiter, renewVerifyHandler);

module.exports = router;
