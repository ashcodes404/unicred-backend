/**
 * PAYMENT CONTROLLER (admin dashboard) — PHASE 8E
 * ==================================================
 * schoolId ALWAYS comes from req.user.schoolId (the admin's own JWT), never
 * from the request — an admin can only ever see their own school's payments.
 */

const paymentService = require("./payment.service");
const { success } = require("../../utils/apiResponse");

/**
 * WHAT: GET /api/admin/payments?page=&limit=
 * RETURNS: 200 + { payments, pagination }.
 */
async function listPaymentsHandler(req, res, next) {
  try {
    const data = await paymentService.listPayments(req.user.schoolId, req.query);
    return success(res, 200, "Payments fetched successfully", data);
  } catch (err) {
    next(err);
  }
}

module.exports = { listPaymentsHandler };
