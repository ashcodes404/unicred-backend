/**
 * INVOICE REPOSITORY (admin dashboard) — PHASE 8E
 * ==================================================
 * Read-only Prisma calls backing the admin-facing invoice list/detail/
 * download endpoints. invoice.service.js calls these functions — it never
 * talks to Prisma directly (same layering as every other module).
 *
 * SECURITY: every single function here takes `schoolId` and puts it
 * directly in the Prisma `where` clause — never fetches by id alone and
 * checks the school afterward in JS. That way a wrong-school id can only
 * ever come back "not found" straight from the database, the same safe
 * pattern notification.repository.js's findNotificationById() already uses.
 */

const prisma = require("../../config/db");

/**
 * WHAT: Fetches one page of a school's invoices, newest first.
 * WHY: Powers GET /api/admin/invoices. `select` pulls only the columns the
 *      dashboard list view needs — never razorpaySignature-equivalent
 *      internals (Invoice doesn't have one, but this is the same discipline
 *      as the renewal-history query).
 * RETURNS: Promise<Invoice[]>
 */
async function findInvoicesBySchoolId(schoolId, skip, limit) {
  return prisma.invoice.findMany({
    where: { schoolId },
    orderBy: { createdAt: "desc" },
    skip,
    take: limit,
    select: {
      id: true,
      invoiceNumber: true,
      amount: true,
      gst: true,
      totalAmount: true,
      baseAmount: true,
      cgstAmount: true,
      sgstAmount: true,
      gstRate: true,
      couponCode: true,
      discountAmount: true,
      originalBaseAmount: true,
      razorpayOrderId: true,
      pdfPath: true,
      emailedAt: true,
      createdAt: true,
    },
  });
}

/**
 * WHAT: Counts a school's total invoices — pagination metadata for the list above.
 * RETURNS: Promise<number>
 */
async function countInvoicesBySchoolId(schoolId) {
  return prisma.invoice.count({ where: { schoolId } });
}

/**
 * WHAT: Fetches ONE invoice, but ONLY if it belongs to the given school.
 * WHY: Powers both GET /api/admin/invoices/:id (detail) and the download
 *      endpoint — findFirst (not findUnique by id) so `schoolId` can be
 *      part of the WHERE clause itself; a different school's invoice id
 *      simply doesn't match and comes back null, which the caller turns
 *      into a 404 — never a 403 that would confirm "this id exists, just
 *      isn't yours".
 * RETURNS: Promise<Invoice|null>
 */
async function findInvoiceByIdForSchool(id, schoolId) {
  return prisma.invoice.findFirst({ where: { id, schoolId } });
}

/**
 * WHAT: Batch-fetches the Payment rows matching a list of razorpayOrderIds.
 * WHY: Invoice doesn't store which plan it was for — only Payment does
 *      (via tempId for registrations, planId for renewals). This is the
 *      first step of resolving that, done ONCE for a whole page of
 *      invoices (no N+1) — see invoice.service.js's attachPlanNames().
 *
 *      NOT additionally filtered by schoolId here: a REGISTRATION Payment
 *      always has schoolId=null (only renewals set it — see Phase 8C's
 *      schema comment on Payment.schoolId), so a `schoolId` filter would
 *      wrongly exclude every registration invoice's plan lookup. This is
 *      still safe — the orderIds passed in were already produced by a
 *      schoolId-scoped Invoice query (findInvoicesBySchoolId /
 *      findInvoiceByIdForSchool), so there's no way to reach another
 *      school's Payment row through this function.
 * RETURNS: Promise<Payment[]> (only the columns needed for plan resolution)
 */
async function findPaymentsByOrderIds(razorpayOrderIds) {
  if (razorpayOrderIds.length === 0) return [];
  return prisma.payment.findMany({
    where: { razorpayOrderId: { in: razorpayOrderIds } },
    select: { razorpayOrderId: true, purpose: true, tempId: true, planId: true },
  });
}

/**
 * WHAT: Batch-fetches PendingRegistration rows (for their selectedPlan) by
 *       a list of tempIds.
 * WHY: A REGISTRATION invoice's plan name lives on the PendingRegistration
 *      row that started that signup (Payment.tempId -> PendingRegistration).
 *      Batched the same way findPaymentsByOrderIds() is, for the same reason.
 * RETURNS: Promise<PendingRegistration[]> (only tempId + selectedPlan selected)
 */
async function findPendingRegistrationsByTempIds(tempIds) {
  if (tempIds.length === 0) return [];
  return prisma.pendingRegistration.findMany({
    where: { tempId: { in: tempIds } },
    select: { tempId: true, selectedPlan: true },
  });
}

module.exports = {
  findInvoicesBySchoolId,
  countInvoicesBySchoolId,
  findInvoiceByIdForSchool,
  findPaymentsByOrderIds,
  findPendingRegistrationsByTempIds,
};
