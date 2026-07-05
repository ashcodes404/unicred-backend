/**
 * PAYMENT SERVICE (admin dashboard) — PHASE 8E
 * ===============================================
 * Business logic for the admin-facing payment list endpoint.
 * payment.controller.js calls this; this file calls payment.repository.js.
 */

const paymentRepository = require("./payment.repository");
const { parsePagination, buildPaginationMeta } = require("../../utils/pagination");

/**
 * WHAT: Returns one page of the requesting admin's school's payments.
 * WHY: Powers GET /api/admin/payments.
 * RETURNS: Promise<{ payments: Payment[], pagination: object }>
 */
async function listPayments(schoolId, query) {
  const { page, limit, skip } = parsePagination(query);

  const [payments, total] = await Promise.all([
    paymentRepository.findPaymentsBySchoolId(schoolId, skip, limit),
    paymentRepository.countPaymentsBySchoolId(schoolId),
  ]);

  return { payments, pagination: buildPaginationMeta(page, limit, total) };
}

module.exports = { listPayments };
