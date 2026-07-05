/**
 * COUPON CONTROLLER — PHASE 8B (admin management)
 * ==================================================
 * Thin HTTP layer for admin coupon management. Reads req.body/req.params,
 * calls coupon.service.js, and shapes the response with the shared
 * success()/error() helpers — same pattern as every other controller.
 *
 * All routes here require an authenticated admin (see coupon.routes.js —
 * authenticate + requireRole("admin"), both reused from the existing auth
 * middleware; no new auth logic lives here).
 */

const couponService = require("./coupon.service");
const { success, error } = require("../../utils/apiResponse");

/**
 * WHAT: POST /api/admin/coupons
 * WHY: Lets an admin create a new coupon (percentage or fixed discount).
 * RETURNS: 201 + the created Coupon.
 */
async function createCouponHandler(req, res, next) {
  try {
    const coupon = await couponService.createCoupon(req.body);
    return success(res, 201, "Coupon created successfully", { coupon });
  } catch (err) {
    next(err);
  }
}

/**
 * WHAT: GET /api/admin/coupons
 * WHY: Lets an admin see every coupon (active or not) for the management
 *      dashboard.
 * RETURNS: 200 + array of Coupons.
 */
async function listCouponsHandler(req, res, next) {
  try {
    const data = await couponService.listCoupons(req.query);
    return success(res, 200, "Coupons fetched successfully", data);
  } catch (err) {
    next(err);
  }
}

/**
 * WHAT: PATCH /api/admin/coupons/:id
 * WHY: Lets an admin update a coupon's limits/dates/description, or flip
 *      isActive to deactivate it early.
 * RETURNS: 200 + the updated Coupon.
 */
async function updateCouponHandler(req, res, next) {
  try {
    const id = Number(req.params.id);
    const coupon = await couponService.updateCoupon(id, req.body);
    return success(res, 200, "Coupon updated successfully", { coupon });
  } catch (err) {
    next(err);
  }
}

/**
 * WHAT: DELETE /api/admin/coupons/:id
 * WHY: Retires a coupon. Soft-deactivates (isActive = false) rather than
 *      deleting the row — see coupon.service.js's deleteCoupon() for why.
 * RETURNS: 200 + the deactivated Coupon.
 */
async function deleteCouponHandler(req, res, next) {
  try {
    const id = Number(req.params.id);
    const coupon = await couponService.deleteCoupon(id);
    return success(res, 200, "Coupon deactivated successfully", { coupon });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createCouponHandler,
  listCouponsHandler,
  updateCouponHandler,
  deleteCouponHandler,
};
