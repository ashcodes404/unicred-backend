/**
 * SUBSCRIPTION CONTROLLER — PHASE 8C
 * =====================================
 * Thin HTTP layer for admin subscription renewal. Reads req.body/req.user,
 * calls subscription.service.js, and shapes the response with the shared
 * success()/error() helpers — same pattern as every other controller.
 *
 * schoolId ALWAYS comes from req.user.schoolId (the admin's own JWT), NEVER
 * from the request body — an admin can only ever act on their own school.
 */

const subscriptionService = require("./subscription.service");
const { success, error } = require("../../utils/apiResponse");

/**
 * WHAT: GET /api/admin/subscription
 * WHY: Shows the admin their school's current plan/expiry/status — the
 *      "renew" screen's starting point.
 * RETURNS: 200 + subscription status.
 */
async function getStatusHandler(req, res, next) {
  try {
    const status = await subscriptionService.getStatus(req.user.schoolId);
    return success(res, 200, "Subscription status fetched successfully", status);
  } catch (err) {
    next(err);
  }
}

/**
 * WHAT: POST /api/admin/subscription/renew-order
 * WHY: Creates a one-time Razorpay order to renew with a chosen plan.
 * RETURNS: 201 + { razorpayOrderId, amount (paise), currency, keyId }.
 */
async function renewOrderHandler(req, res, next) {
  try {
    const { planId } = req.body;

    if (!planId) {
      return error(res, 400, "planId is required");
    }

    // Number(planId) turns the incoming value into a number (or NaN if it
    // can't be — e.g. "abc"). Number.isInteger() then makes sure it's a
    // whole number, and > 0 rules out 0/negative ids. Any planId that fails
    // this is rejected here with a clear 400, instead of reaching the
    // database with a bad value.
    const parsedPlanId = Number(planId);
    if (!Number.isInteger(parsedPlanId) || parsedPlanId <= 0) {
      return error(res, 400, "planId must be a valid plan ID");
    }

    const order = await subscriptionService.createRenewOrder(req.user.schoolId, parsedPlanId);
    return success(res, 201, "Renewal payment order created successfully", order);
  } catch (err) {
    next(err);
  }
}

/**
 * WHAT: POST /api/admin/subscription/renew-verify
 * WHY: Called right after Razorpay's checkout widget reports success —
 *      verifies the payment is genuine and, only if so, extends the
 *      subscription.
 * RETURNS: 200 + { alreadyProcessed, subscriptionExpiryDate }.
 */
async function renewVerifyHandler(req, res, next) {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const requiredFields = { razorpay_order_id, razorpay_payment_id, razorpay_signature };
    const missingFields = Object.entries(requiredFields)
      .filter(([, value]) => value === undefined || value === null || value === "")
      .map(([key]) => key);

    if (missingFields.length > 0) {
      return error(res, 400, `Missing required field(s): ${missingFields.join(", ")}`);
    }

    const result = await subscriptionService.renewVerify(req.user.schoolId, {
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
    });

    return success(res, 200, "Subscription renewed successfully", result);
  } catch (err) {
    next(err);
  }
}

/**
 * WHAT: GET /api/admin/subscription/history?page=&limit=
 * WHY: Powers the dashboard's renewal timeline for the admin's own school.
 * RETURNS: 200 + { renewals, pagination }.
 */
async function getHistoryHandler(req, res, next) {
  try {
    const history = await subscriptionService.getHistory(req.user.schoolId, req.query);
    return success(res, 200, "Subscription history fetched successfully", history);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getStatusHandler,
  renewOrderHandler,
  renewVerifyHandler,
  getHistoryHandler,
};
