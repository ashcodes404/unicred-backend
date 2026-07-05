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
const { LOGIN_URL, GST_RATE, GST_SELLER_GSTIN } = require("../config/env");
const { sendWelcomeInvoiceEmail } = require("../utils/email");
const { generateInvoiceNumber, buildInvoicePdf } = require("../services/invoice.service");
const { calculateGst } = require("../utils/gst"); // shared base→CGST/SGST/total split — see utils/gst.js
const registrationRepository = require("../modules/registration/registration.repository"); // reused for findPlanByName
const subscriptionRepository = require("../modules/subscription/subscription.repository"); // reused for findPlanById (renewal payments)

/**
 * WHAT: Figures out which SubscriptionPlan an invoice is actually for.
 * WHY: A REGISTRATION payment has no planId of its own — school.plan (set
 *      once, at registration time) is the only source, so we look the plan
 *      up by that name.
 *
 *      A RENEWAL payment always carries its OWN planId (stamped on when the
 *      renewal order was created — see subscription.repository.js's
 *      createRenewalPayment). We MUST use that instead of school.plan,
 *      because:
 *        - a QUEUED renewal deliberately leaves school.plan untouched (it's
 *          still whatever the CURRENT plan is, not the one just purchased),
 *        - and school.plan can even be null for a school that was never
 *          fully activated.
 *      Using school.plan for a renewal invoice would silently bill the
 *      WRONG plan, or crash entirely — this is exactly what happened for
 *      school 90001 / job 24: a renewal payment (planId=3, "2 Years") got
 *      queued, so school.plan stayed null, and the old code tried
 *      findPlanByName(null) and crashed.
 *
 * @param {object} payment - the local Payment row (has planId for renewals, null for registrations)
 * @param {object} school
 * RETURNS: Promise<SubscriptionPlan|null>
 */
async function resolvePlanForInvoice(payment, school) {
  if (payment.planId) {
    return subscriptionRepository.findPlanById(payment.planId);
  }
  return registrationRepository.findPlanByName(school.plan);
}

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
 * @param {object} params
 * @param {object} params.school
 * @param {object} params.payment
 * @param {string|null} [params.couponCode] - PHASE 8B, set when a coupon was applied
 * @param {number} [params.discountAmount] - PHASE 8B, rupees knocked off the base (0 if no coupon)
 * @param {number|null} [params.originalBaseAmount] - PHASE 8B, plan's true base BEFORE discount
 * @param {number|null} [params.discountedBaseAmount] - PHASE 8B, base AFTER discount — what GST is computed on
 * RETURNS: Promise<Invoice>
 */
async function findOrCreateInvoice({
  school,
  payment,
  couponCode = null,
  discountAmount = 0,
  originalBaseAmount = null,
  discountedBaseAmount = null,
}) {
  const existing = await prisma.invoice.findFirst({
    where: { schoolId: school.id, razorpayOrderId: payment.razorpayOrderId },
  });
  if (existing) return existing;

  // PHASE 8A — GST breakdown.
  // We want the ORIGINAL pre-tax plan price, not a reverse-divided guess —
  // resolvePlanForInvoice() picks the right source (payment.planId for
  // renewals, school.plan for registrations) — see its own comment above
  // for why this can't just always use school.plan.
  const plan = await resolvePlanForInvoice(payment, school);

  // Extremely unlikely fallback: only reachable if the plan was deactivated
  // in the few seconds between payment and invoicing. Derives the base
  // price back out of the GST-inclusive total actually charged, using the
  // currently configured rate, so an invoice can still be produced.
  const fallbackBaseAmount = plan ? plan.price : payment.amount / (1 + GST_RATE / 100);

  // PHASE 8B — if a coupon was applied, registration.service.js already
  // computed the discounted base at payment-completion time and passed it
  // through the job payload — GST must be computed on THAT (discounted)
  // base, never the original plan price. When no coupon applied,
  // discountedBaseAmount is null and we fall back to the pre-8B behavior.
  const baseAmount = discountedBaseAmount != null ? discountedBaseAmount : fallbackBaseAmount;

  const { gstRate, gstAmount, cgstAmount, sgstAmount, totalAmount } = calculateGst(baseAmount);

  // Retry a handful of times in the extremely unlikely event of an
  // invoiceNumber collision with another school's invoice.
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await prisma.invoice.create({
        data: {
          schoolId: school.id,
          invoiceNumber: generateInvoiceNumber(school.id),
          amount: totalAmount, // "amount actually paid" — GST-inclusive, matches Payment.amount
          gst: gstAmount, // combined CGST + SGST
          totalAmount,
          baseAmount, // the DISCOUNTED base GST was computed on (== fallbackBaseAmount when no coupon)
          cgstAmount,
          sgstAmount,
          gstRate,
          sellerGstin: GST_SELLER_GSTIN,
          // PHASE 8B — null/0 for every pre-coupon invoice and every invoice
          // with no coupon applied.
          couponCode,
          discountAmount,
          originalBaseAmount: originalBaseAmount != null ? originalBaseAmount : fallbackBaseAmount,
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
 * @param {string|null} [data.couponCode] - PHASE 8B, set when a coupon was applied
 * @param {number} [data.discountAmount] - PHASE 8B, rupees knocked off the base
 * @param {number|null} [data.originalBaseAmount] - PHASE 8B, plan's true base BEFORE discount
 * @param {number|null} [data.discountedBaseAmount] - PHASE 8B, base AFTER discount
 * RETURNS: Promise<void>
 */
async function processGenerateInvoiceJob({
  schoolId,
  paymentId,
  couponCode = null,
  discountAmount = 0,
  originalBaseAmount = null,
  discountedBaseAmount = null,
}) {
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
  let invoice = await findOrCreateInvoice({
    school,
    payment,
    couponCode,
    discountAmount,
    originalBaseAmount,
    discountedBaseAmount,
  });

  // Resolve the plan this invoice is really for (payment.planId for
  // renewals, school.plan for registrations — see resolvePlanForInvoice's
  // comment above). Used for the PDF/email's "Plan" line so a QUEUED
  // renewal's invoice shows the plan actually purchased, not whatever
  // school.plan currently happens to be (untouched until the queue
  // activates). Falls back to school's own fields if resolution comes up
  // empty, so this never crashes here even in an edge case.
  const invoicePlan = await resolvePlanForInvoice(payment, school);
  const planNameForDisplay = invoicePlan?.name ?? school.plan;
  const planDurationForDisplay = invoicePlan?.durationMonths ?? school.planDurationMonths;

  // 3. Generate the PDF — skip if a previous attempt already made one.
  if (!invoice.pdfPath) {
    const pdfPath = await buildInvoicePdf({
      invoiceNumber: invoice.invoiceNumber,
      schoolName: school.name,
      adminName: admin.name,
      plan: planNameForDisplay,
      durationMonths: planDurationForDisplay,
      startDate: school.subscriptionStartDate,
      expiryDate: school.subscriptionExpiryDate,
      amount: invoice.amount,
      gst: invoice.gst,
      totalAmount: invoice.totalAmount,
      baseAmount: invoice.baseAmount,
      cgstAmount: invoice.cgstAmount,
      sgstAmount: invoice.sgstAmount,
      gstRate: invoice.gstRate,
      sellerGstin: invoice.sellerGstin,
      couponCode: invoice.couponCode,
      discountAmount: invoice.discountAmount,
      originalBaseAmount: invoice.originalBaseAmount,
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
      plan: planNameForDisplay,
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
