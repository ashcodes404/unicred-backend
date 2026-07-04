/**
 * PAYMENT REPOSITORY (admin dashboard) — PHASE 8E
 * ==================================================
 * Read-only Prisma calls backing the admin-facing payment list endpoint.
 * payment.service.js calls these — it never touches Prisma directly.
 */

const prisma = require("../../config/db");

/**
 * WHAT: Fetches one page of a school's payments, newest first.
 * WHY: Powers GET /api/admin/payments. `select` pulls only what the
 *      dashboard needs — never razorpaySignature (an internal verification
 *      detail, not something to expose over an API).
 *
 *      Matches on schoolId directly — reliable for BOTH registration and
 *      renewal payments now that registration.repository.js's
 *      createSchoolAndAdmin() stamps schoolId onto the original
 *      registration Payment too (PHASE 8E fix, see that file's comment).
 * RETURNS: Promise<Payment[]>
 */
async function findPaymentsBySchoolId(schoolId, skip, limit) {
  return prisma.payment.findMany({
    where: { schoolId },
    orderBy: { createdAt: "desc" },
    skip,
    take: limit,
    select: {
      id: true,
      amount: true,
      currency: true,
      status: true,
      purpose: true,
      razorpayOrderId: true,
      razorpayPaymentId: true,
      createdAt: true,
    },
  });
}

/**
 * WHAT: Counts a school's total payments — pagination metadata for the list above.
 * RETURNS: Promise<number>
 */
async function countPaymentsBySchoolId(schoolId) {
  return prisma.payment.count({ where: { schoolId } });
}

module.exports = {
  findPaymentsBySchoolId,
  countPaymentsBySchoolId,
};
