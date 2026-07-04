// src/jobs/invoice.processor.js
//
// PHASE 4 — runs AFTER a school + admin have already been created (Phase 3).
// Loads everything needed for an invoice, creates the Invoice row, renders
// the PDF, and emails it to the admin. This all happens in the background —
// verify-payment (Phase 3) already responded to the user before this job
// even starts, so nothing here can block or break that response. If this
// job throws, BullMQ retries it (see src/queues/invoice.queue.js) — the
// School/User/Payment rows created in Phase 3 are never touched or rolled
// back because of an invoice/email failure.
//
// Every step here is idempotent so a BullMQ retry never creates duplicate
// Invoice rows, duplicate PDFs, or duplicate emails — see the comments below.

const prisma = require("../config/db");
const { LOGIN_URL } = require("../config/env");
const { sendWelcomeInvoiceEmail } = require("../utils/email");
const { generateInvoiceNumber, buildInvoicePdf } = require("../services/invoice.service");

/**
 * WHAT: Finds an existing Invoice for this school's payment, or creates one
 *       if it doesn't exist yet.
 * WHY: BullMQ may retry this job (e.g. if the PDF step below fails). If we
 *      always called `create`, a retry would insert a second Invoice row
 *      for the same payment. Checking first makes the whole job safe to
 *      run more than once.
 *
 *      invoiceNumber has a tiny chance of colliding with another school's
 *      invoice (6 random base36 characters) — if Prisma reports a unique
 *      constraint violation (error code "P2002") on create, we just
 *      generate a fresh number and try again.
 * RETURNS: Promise<Invoice>
 */
async function findOrCreateInvoice({ school, payment }) {
  const existing = await prisma.invoice.findFirst({
    where: { schoolId: school.id, razorpayOrderId: payment.razorpayOrderId },
  });
  if (existing) return existing;

  const gst = 0; // real GST calculation is Phase 8 — always 0 for now
  const amount = payment.amount;
  const totalAmount = amount + gst;

  // Retry a handful of times in the extremely unlikely event of an
  // invoiceNumber collision with another school's invoice.
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await prisma.invoice.create({
        data: {
          schoolId: school.id,
          invoiceNumber: generateInvoiceNumber(school.id),
          amount,
          gst,
          totalAmount,
          razorpayOrderId: payment.razorpayOrderId,
          razorpayPaymentId: payment.razorpayPaymentId,
        },
      });
    } catch (err) {
      // "P2002" is Prisma's error code for a unique-constraint violation.
      // Anything else is a real problem — let it bubble up and fail the job.
      if (err.code !== "P2002" || attempt === MAX_ATTEMPTS) throw err;
    }
  }
}

/**
 * WHAT: Processes one "generate-invoice" job — the full Phase 4 flow.
 * WHY: This is what src/workers/invoice.worker.js calls for every job on
 *      the "invoice" queue.
 *
 * @param {object} data
 * @param {number} data.schoolId
 * @param {number} data.paymentId - Payment.id (the local DB row, not the Razorpay id)
 * RETURNS: Promise<void>
 */
async function processGenerateInvoiceJob({ schoolId, paymentId }) {
  // 1. Load school + payment + admin. These were all created together in
  //    Phase 3's transaction, so if any is missing something is seriously
  //    wrong — throwing here lets BullMQ log it clearly and retry.
  const school = await prisma.school.findUnique({ where: { id: schoolId } });
  if (!school) throw new Error(`Invoice job: School ${schoolId} not found`);

  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new Error(`Invoice job: Payment ${paymentId} not found`);

  // The admin User created in Phase 3 for this school — role is always
  // "admin" for the one user this flow creates per school.
  const admin = await prisma.user.findFirst({
    where: { schoolId, role: "admin" },
  });
  if (!admin) throw new Error(`Invoice job: admin User for school ${schoolId} not found`);

  // 2. Create (or reuse, on retry) the Invoice row.
  let invoice = await findOrCreateInvoice({ school, payment });

  // 3. Generate the PDF — skip if a previous attempt already made one.
  if (!invoice.pdfPath) {
    const pdfPath = await buildInvoicePdf({
      invoiceNumber: invoice.invoiceNumber,
      schoolName: school.name,
      adminName: admin.name,
      plan: school.plan,
      durationMonths: school.planDurationMonths,
      startDate: school.subscriptionStartDate,
      expiryDate: school.subscriptionExpiryDate,
      amount: invoice.amount,
      gst: invoice.gst,
      totalAmount: invoice.totalAmount,
      razorpayPaymentId: invoice.razorpayPaymentId,
      razorpayOrderId: invoice.razorpayOrderId,
      transactionDate: invoice.createdAt,
    });

    invoice = await prisma.invoice.update({
      where: { id: invoice.id },
      data: { pdfPath },
    });
  }

  // 4. Email the invoice — skip if a previous attempt already sent it.
  if (!invoice.emailedAt) {
    await sendWelcomeInvoiceEmail({
      email: admin.email,
      name: admin.name,
      schoolName: school.name,
      plan: school.plan,
      loginUrl: LOGIN_URL,
      attachmentPath: invoice.pdfPath,
    });

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { emailedAt: new Date() },
    });
  }
}

module.exports = { processGenerateInvoiceJob };
