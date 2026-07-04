// =============================================================================
// PAYMENT ROUTES (admin dashboard) — PHASE 8E
// =============================================================================
// Mounted at /api/admin/payments in routes/index.js.
//
//   GET /api/admin/payments — paginated list, this school only
//
// Admin-only (authenticate + requireRole("admin"), reused as-is).
// =============================================================================

const express = require("express");
const router = express.Router();

const { listPaymentsHandler } = require("./payment.controller");
const authenticate = require("../../middleware/auth.middleware");
const requireRole = require("../../middleware/role.middleware");
const { registrationReadRateLimiter } = require("../../middleware/rateLimit.middleware");

router.get("/", authenticate, requireRole("admin"), registrationReadRateLimiter, listPaymentsHandler);

module.exports = router;
