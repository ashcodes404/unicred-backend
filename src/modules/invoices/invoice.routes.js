// =============================================================================
// INVOICE ROUTES (admin dashboard) — PHASE 8E
// =============================================================================
// Mounted at /api/admin/invoices in routes/index.js.
//
//   GET /api/admin/invoices              — paginated list, this school only
//   GET /api/admin/invoices/:id          — single invoice detail
//   GET /api/admin/invoices/:id/download — stream the invoice PDF
//
// Admin-only (authenticate + requireRole("admin"), reused as-is — no new
// auth logic). Every handler scopes its query to req.user.schoolId, so one
// admin can never read (or download) another school's invoice.
// =============================================================================

const express = require("express");
const router = express.Router();

const {
  listInvoicesHandler,
  getInvoiceHandler,
  downloadInvoiceHandler,
} = require("./invoice.controller");

const authenticate = require("../../middleware/auth.middleware");
const requireRole = require("../../middleware/role.middleware");

// Reused as-is — same read-tier limiter registration's plan/review GETs use.
const { registrationReadRateLimiter } = require("../../middleware/rateLimit.middleware");

router.get("/", authenticate, requireRole("admin"), registrationReadRateLimiter, listInvoicesHandler);
router.get("/:id", authenticate, requireRole("admin"), registrationReadRateLimiter, getInvoiceHandler);
router.get("/:id/download", authenticate, requireRole("admin"), registrationReadRateLimiter, downloadInvoiceHandler);

module.exports = router;
