// =============================================================================
// COUPON ADMIN ROUTES — PHASE 8B
// =============================================================================
// Mounted at /api/admin/coupons in routes/index.js.
//
// Coupons are a platform-wide concept (one coupon can be used across many
// schools), not a per-school resource — so unlike departments/students/etc.
// these routes use `authenticate` + `requireRole("admin")` only, WITHOUT
// tenant.middleware.js (there is no req.schoolId scoping here; Coupon has no
// schoolId column, by design).
//
//   POST   /api/admin/coupons       — create a coupon
//   GET    /api/admin/coupons       — list all coupons
//   PATCH  /api/admin/coupons/:id   — update a coupon (e.g. deactivate)
//   DELETE /api/admin/coupons/:id   — soft-deactivate a coupon
// =============================================================================

const express = require("express");
const router = express.Router();

const {
  createCouponHandler,
  listCouponsHandler,
  updateCouponHandler,
  deleteCouponHandler,
} = require("./coupon.controller");

// Reused as-is from the rest of the app — no new auth logic for this module.
const authenticate = require("../../middleware/auth.middleware");
const requireRole = require("../../middleware/role.middleware");

router.post("/", authenticate, requireRole("admin"), createCouponHandler);
router.get("/", authenticate, requireRole("admin"), listCouponsHandler);
router.patch("/:id", authenticate, requireRole("admin"), updateCouponHandler);
router.delete("/:id", authenticate, requireRole("admin"), deleteCouponHandler);

module.exports = router;
