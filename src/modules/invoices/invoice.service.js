/**
 * INVOICE SERVICE (admin dashboard) — PHASE 8E
 * ===============================================
 * Business logic for the admin-facing invoice list/detail/download
 * endpoints. invoice.controller.js calls these functions; this file calls
 * invoice.repository.js — it never touches Prisma directly.
 *
 * Not to be confused with src/services/invoice.service.js (Phase 4's PDF
 * BUILDER — generateInvoiceNumber/buildInvoicePdf, used by the background
 * invoice job). This file only READS already-generated invoices for the
 * dashboard; it never creates or modifies one.
 */

const fs = require("fs");
const invoiceRepository = require("./invoice.repository");
const subscriptionRepository = require("../subscription/subscription.repository"); // reused: findPlansByIds — no duplicate plan-lookup logic
const { parsePagination, buildPaginationMeta } = require("../../utils/pagination");

/**
 * WHAT: Given a page of Invoice rows, batch-resolves and attaches each
 *       one's plan name as a `.plan` field.
 * WHY: Invoice never stored which plan it was for (see repository's
 *      findPaymentsByOrderIds comment) — this derives it via Payment:
 *        - purpose="registration" -> Payment.tempId -> PendingRegistration.selectedPlan
 *        - purpose="renewal"      -> Payment.planId -> SubscriptionPlan.name
 *      Done with a FIXED number of batched queries (2-3 total) regardless
 *      of how many invoices are on the page — never one query per invoice.
 *
 * @param {Invoice[]} invoices - rows from findInvoicesBySchoolId/findInvoiceByIdForSchool
 * RETURNS: Promise<object[]> - same invoices, each with a `plan` field added
 */
async function attachPlanNames(invoices) {
  if (invoices.length === 0) return [];

  const orderIds = invoices.map((inv) => inv.razorpayOrderId);
  const payments = await invoiceRepository.findPaymentsByOrderIds(orderIds);
  const paymentByOrderId = new Map(payments.map((p) => [p.razorpayOrderId, p]));

  // Split into the two ways a plan name can be reached, so each is
  // resolved with exactly ONE batched query.
  const tempIds = [];
  const planIds = [];
  for (const payment of payments) {
    if (payment.purpose === "renewal" && payment.planId != null) planIds.push(payment.planId);
    else if (payment.tempId != null) tempIds.push(payment.tempId);
  }

  const [pendingRegs, plans] = await Promise.all([
    invoiceRepository.findPendingRegistrationsByTempIds([...new Set(tempIds)]),
    subscriptionRepository.findPlansByIds([...new Set(planIds)]),
  ]);
  const planNameByTempId = new Map(pendingRegs.map((r) => [r.tempId, r.selectedPlan]));
  const planNameByPlanId = new Map(plans.map((p) => [p.id, p.name]));

  return invoices.map((invoice) => {
    const payment = paymentByOrderId.get(invoice.razorpayOrderId);
    let plan = null;
    if (payment) {
      plan =
        payment.purpose === "renewal"
          ? planNameByPlanId.get(payment.planId) ?? null
          : planNameByTempId.get(payment.tempId) ?? null;
    }
    return { ...invoice, plan };
  });
}

/**
 * WHAT: Returns one page of the requesting admin's school's invoices.
 * WHY: Powers GET /api/admin/invoices.
 * RETURNS: Promise<{ invoices: object[], pagination: object }>
 */
async function listInvoices(schoolId, query) {
  const { page, limit, skip } = parsePagination(query);

  const [rows, total] = await Promise.all([
    invoiceRepository.findInvoicesBySchoolId(schoolId, skip, limit),
    invoiceRepository.countInvoicesBySchoolId(schoolId),
  ]);

  const invoices = await attachPlanNames(rows);

  return { invoices, pagination: buildPaginationMeta(page, limit, total) };
}

/**
 * WHAT: Returns one invoice's full detail — only if it belongs to the
 *       requesting admin's school.
 * WHY: Powers GET /api/admin/invoices/:id.
 * RETURNS: Promise<object>
 */
async function getInvoiceById(schoolId, id) {
  const invoice = await invoiceRepository.findInvoiceByIdForSchool(id, schoolId);
  if (!invoice) {
    const err = new Error("Invoice not found.");
    err.statusCode = 404;
    throw err;
  }

  const [withPlan] = await attachPlanNames([invoice]);
  return withPlan;
}

/**
 * WHAT: Verifies an invoice belongs to the requesting admin's school and
 *       its PDF file actually exists on disk, then returns what the
 *       controller needs to stream it.
 * WHY: Powers GET /api/admin/invoices/:id/download. Ownership is checked
 *      BEFORE anything touches the filesystem — the query itself already
 *      makes a wrong-school id come back null (see repository comment).
 *      A null/missing pdfPath, or a path that no longer exists on disk
 *      (e.g. manually cleaned up), is reported as the SAME generic 404 as
 *      "doesn't exist" — never leaking the raw filesystem path in the error.
 * RETURNS: Promise<{ filePath: string, downloadName: string }>
 */
async function getInvoiceFileForDownload(schoolId, id) {
  const invoice = await invoiceRepository.findInvoiceByIdForSchool(id, schoolId);
  if (!invoice) {
    const err = new Error("Invoice not found.");
    err.statusCode = 404;
    throw err;
  }

  // fs.existsSync() — Node's synchronous "does this path exist" check.
  // Synchronous is fine here: it's one quick stat() call on a single small
  // admin request, not a hot path under load.
  if (!invoice.pdfPath || !fs.existsSync(invoice.pdfPath)) {
    const err = new Error("Invoice PDF is not available.");
    err.statusCode = 404;
    throw err;
  }

  return {
    filePath: invoice.pdfPath,
    downloadName: `${invoice.invoiceNumber}.pdf`,
  };
}

module.exports = {
  listInvoices,
  getInvoiceById,
  getInvoiceFileForDownload,
};
