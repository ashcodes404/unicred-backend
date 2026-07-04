/**
 * SUBSCRIPTION SERVICE — PHASE 8C
 * ==================================
 * Business logic for manual subscription renewal: checking status, creating
 * a one-time Razorpay renewal order, and completing a renewal once payment
 * is confirmed (from either the browser's renew-verify call or Razorpay's
 * webhook — see completeRenewalForPayment below, which both paths share).
 *
 * Deliberately reuses, rather than duplicates:
 *   - calculateGst()                    from utils/gst.js
 *   - isValidRazorpaySignature()        from registration.service.js
 *   - rupeesToPaise() / addMonths()     from registration.service.js
 *   - razorpay client                   from config/razorpay.js
 *   - enqueueGenerateInvoice()          from queues/invoice.queue.js (same
 *     background worker that emails registration invoices)
 *   - isSchoolExpired()                 from utils/schoolSubscription.js
 */

const subscriptionRepository = require("./subscription.repository");
const registrationRepository = require("../registration/registration.repository"); // reused: findPaymentByOrderId
const razorpay = require("../../config/razorpay");
const { RAZORPAY_KEY_ID } = require("../../config/env");
const { calculateGst } = require("../../utils/gst");
const { isSchoolExpired } = require("../../utils/schoolSubscription");
const { enqueueGenerateInvoice } = require("../../queues/invoice.queue");
const { parsePagination, buildPaginationMeta } = require("../../utils/pagination"); // PHASE 8E

/**
 * WHAT: Lazily requires registration.service.js's isValidRazorpaySignature/
 *       rupeesToPaise/addMonths only when actually called.
 * WHY: registration.service.js's webhook handler requires THIS file (to
 *      route renewal webhook events here) — requiring registration.service.js
 *      back at the TOP of this file would create a circular require that,
 *      depending on which module loads first, can hand one side an
 *      incomplete (still-loading) module.exports. Deferring the require
 *      until a function actually runs sidesteps that entirely, since by
 *      then both files have finished loading.
 * RETURNS: the registration.service.js exports object
 */
function registrationService() {
  return require("../registration/registration.service");
}

/**
 * WHAT: Given a school and a plan's durationMonths, computes the new
 *       subscription expiry date — the exact before/after-expiry rule from
 *       the spec.
 * WHY: Shared by createRenewOrder (to show the admin what they're about to
 *      get, if we choose to preview it) and completeRenewalForPayment (the
 *      real, authoritative computation done at payment-completion time).
 *      Only ONE place decides this math.
 *
 * @param {object} school - needs subscriptionExpiryDate
 * @param {number} planDurationMonths
 * RETURNS: Date
 */
function computeNewExpiry(school, planDurationMonths) {
  const now = new Date();
  const { addMonths } = registrationService();

  // BEFORE expiry: the admin is renewing early, so we extend from the
  // CURRENT expiry date — no paid time is lost. E.g. expiry is 2026-08-01,
  // renewing today (2026-07-04) with a 12-month plan → new expiry 2027-08-01.
  if (school.subscriptionExpiryDate && school.subscriptionExpiryDate > now) {
    return addMonths(school.subscriptionExpiryDate, planDurationMonths);
  }

  // AFTER expiry (or no expiry date at all): the gap between expiry and now
  // is dead time that isn't compensated — the new period starts from NOW.
  // E.g. expiry was 2026-06-24, renewing today (2026-07-04) with a 12-month
  // plan → new expiry 2027-07-04 (the 10 expired days are simply gone).
  return addMonths(now, planDurationMonths);
}

/**
 * WHAT: Returns the requesting admin's school's subscription status.
 * WHY: Powers GET /api/admin/subscription — the "renew" screen needs to
 *      show current plan, expiry date, days left, and whether it's expired.
 *
 * @param {number} schoolId - from req.user.schoolId (JWT), never the client
 * RETURNS: Promise<object>
 */
async function getStatus(schoolId) {
  const school = await subscriptionRepository.findSchoolById(schoolId);
  if (!school) {
    const err = new Error("School not found.");
    err.statusCode = 404;
    throw err;
  }

  const now = new Date();
  const expired = isSchoolExpired(school);

  // Math.ceil() rounds a fractional day count UP — e.g. 2.1 days left shows
  // as "3 days left" rather than "2", which is friendlier/more accurate for
  // a countdown (there IS still a bit of today left).
  const daysLeft = school.subscriptionExpiryDate
    ? Math.ceil((school.subscriptionExpiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  return {
    plan: school.plan,
    planDurationMonths: school.planDurationMonths,
    subscriptionStartDate: school.subscriptionStartDate,
    subscriptionExpiryDate: school.subscriptionExpiryDate,
    subscriptionStatus: school.subscriptionStatus,
    paymentStatus: school.paymentStatus,
    isExpired: expired,
    daysLeft: expired ? 0 : daysLeft,
  };
}

/**
 * WHAT: Creates a one-time Razorpay order to renew the admin's own school's
 *       subscription for a chosen plan.
 * WHY: Powers POST /api/admin/subscription/renew-order. NO coupon logic —
 *      renewals are never discounted (per spec). Base price + GST reuses
 *      calculateGst() exactly like registration's createOrder(), just
 *      without the coupon branch.
 *
 * IDEMPOTENCY: reuses an existing unpaid renewal order for this school
 * instead of creating a second one — same reasoning as registration's
 * createOrder() (e.g. the admin refreshed the renewal checkout page).
 *
 * @param {number} schoolId - from req.user.schoolId (JWT) — an admin can only renew THEIR OWN school
 * @param {number} planId - which SubscriptionPlan to renew with
 * RETURNS: Promise<{ razorpayOrderId, amount, currency, keyId }>
 *          `amount` is in paise, same shape as registration's createOrder().
 */
async function createRenewOrder(schoolId, planId) {
  const school = await subscriptionRepository.findSchoolById(schoolId);
  if (!school) {
    const err = new Error("School not found.");
    err.statusCode = 404;
    throw err;
  }

  const plan = await subscriptionRepository.findPlanById(planId);
  if (!plan) {
    const err = new Error("Selected plan is not valid or active.");
    err.statusCode = 400;
    throw err;
  }

  // ── Idempotent retry: reuse an existing unpaid renewal order ──
  const existingPayment = await subscriptionRepository.findCreatedRenewalPaymentBySchoolId(schoolId);
  if (existingPayment) {
    const { rupeesToPaise } = registrationService();
    return {
      razorpayOrderId: existingPayment.razorpayOrderId,
      amount: rupeesToPaise(existingPayment.amount),
      currency: existingPayment.currency,
      keyId: RAZORPAY_KEY_ID,
    };
  }

  // Base price comes from OUR OWN plan lookup — never from anything the
  // client sends — so a tampered request can't renew for less than the
  // real price. Same GST treatment as registration: base + GST, no coupon.
  const { totalAmount } = calculateGst(plan.price);
  const { rupeesToPaise } = registrationService();
  const amountInPaise = rupeesToPaise(totalAmount);

  let razorpayOrder;
  try {
    razorpayOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: "INR",
      receipt: `renewal_${schoolId}_${Date.now()}`,
    });
  } catch (razorpayErr) {
    const err = new Error("Failed to create renewal payment order. Please try again.");
    err.statusCode = 500;
    throw err;
  }

  const payment = await subscriptionRepository.createRenewalPayment({
    schoolId,
    planId,
    razorpayOrderId: razorpayOrder.id,
    amount: totalAmount,
    currency: razorpayOrder.currency,
  });

  return {
    razorpayOrderId: payment.razorpayOrderId,
    amount: amountInPaise,
    currency: payment.currency,
    keyId: RAZORPAY_KEY_ID,
  };
}

/**
 * WHAT: Given a Payment row for a renewal (purpose="renewal") that is NOT
 *       yet marked paid, completes the renewal: computes the new expiry,
 *       extends the school, creates a GST invoice, and enqueues the
 *       invoice-email job. Shared by BOTH ways a renewal payment can be
 *       confirmed — renew-verify (browser) and the payment.captured webhook
 *       — exactly like registration's completeRegistrationForPayment() is
 *       shared by verify-payment and its webhook.
 * WHY: One function, one set of rules, so a renewal can never be completed
 *      differently (or twice) depending on which path got there first.
 *
 * IDEMPOTENCY: subscription.repository.js's completeRenewalTransaction()
 * does the actual "flip to paid" via a conditional updateMany (only matches
 * rows NOT already "paid"), inside the same transaction that extends the
 * expiry — so whichever caller (verify or webhook) arrives first does the
 * real work, and the other sees alreadyProcessed=true and changes nothing.
 *
 * @param {object} payment - the local Payment row (purpose="renewal")
 * RETURNS: Promise<{ alreadyProcessed: boolean, schoolId: number }>
 */
async function completeRenewalForPayment(payment) {
  // Fast-path idempotency check — avoids even starting a transaction for
  // the common case of a duplicate call (e.g. webhook arriving after
  // renew-verify already succeeded).
  if (payment.status === "paid") {
    return { alreadyProcessed: true, schoolId: payment.schoolId };
  }

  const school = await subscriptionRepository.findSchoolById(payment.schoolId);
  if (!school) {
    const err = new Error(`Renewal payment ${payment.id} has no matching School ${payment.schoolId}`);
    err.statusCode = 500;
    throw err;
  }

  const plan = await subscriptionRepository.findPlanById(payment.planId);
  if (!plan) {
    const err = new Error(`Renewal payment ${payment.id}'s plan ${payment.planId} no longer exists`);
    err.statusCode = 500;
    throw err;
  }

  const newExpiryDate = computeNewExpiry(school, plan.durationMonths);

  const { school: updatedSchool, alreadyProcessed } = await subscriptionRepository.completeRenewalTransaction({
    paymentId: payment.id,
    razorpayOrderId: payment.razorpayOrderId,
    razorpayPaymentId: payment.razorpayPaymentId,
    schoolId: payment.schoolId,
    planName: plan.name,
    planDurationMonths: plan.durationMonths,
    newExpiryDate,
  });

  if (alreadyProcessed) {
    return { alreadyProcessed: true, schoolId: payment.schoolId };
  }

  // Invoice + email — background job, same reasoning as registration: never
  // block or risk the renewal itself on PDF/email generation. No coupon
  // fields passed (renewals never discount), so the invoice job records
  // this exactly like any other no-coupon invoice.
  try {
    await enqueueGenerateInvoice({ schoolId: updatedSchool.id, paymentId: payment.id });
  } catch (enqueueErr) {
    console.error(
      `Failed to enqueue renewal invoice for school ${updatedSchool.id}:`,
      enqueueErr.message,
    );
  }

  return { alreadyProcessed: false, schoolId: updatedSchool.id };
}

/**
 * WHAT: Verifies a Razorpay checkout signature for a renewal payment, then
 *       completes it.
 * WHY: Powers POST /api/admin/subscription/renew-verify — the primary, fast
 *      path called by the frontend right after Razorpay's checkout widget
 *      reports success. Reuses isValidRazorpaySignature() unchanged — the
 *      same HMAC check registration's verifyPayment() uses.
 *
 * @param {number} schoolId - from req.user.schoolId (JWT) — confirms this
 *        order actually belongs to the calling admin's own school
 * @param {object} params
 * @param {string} params.razorpayOrderId
 * @param {string} params.razorpayPaymentId
 * @param {string} params.razorpaySignature
 * RETURNS: Promise<{ alreadyProcessed: boolean, subscriptionExpiryDate: Date }>
 */
async function renewVerify(schoolId, { razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
  const payment = await registrationRepository.findPaymentByOrderId(razorpayOrderId);

  if (!payment || payment.purpose !== "renewal") {
    const err = new Error("Renewal order not found.");
    err.statusCode = 404;
    throw err;
  }

  // An admin can only verify a renewal for THEIR OWN school — stops one
  // school's admin from confirming (or probing) another school's order.
  if (payment.schoolId !== schoolId) {
    const err = new Error("This renewal order does not belong to your school.");
    err.statusCode = 403;
    throw err;
  }

  // Idempotency fast-path — same as registration's verifyPayment().
  if (payment.status === "paid") {
    const school = await subscriptionRepository.findSchoolById(schoolId);
    return {
      alreadyProcessed: true,
      subscriptionExpiryDate: school?.subscriptionExpiryDate ?? null,
    };
  }

  const { isValidRazorpaySignature } = registrationService();
  const signatureIsValid = isValidRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);

  if (!signatureIsValid) {
    const err = new Error("Payment verification failed. Signature mismatch.");
    err.statusCode = 400;
    throw err;
  }

  await completeRenewalForPayment({ ...payment, razorpayPaymentId });

  const updatedSchool = await subscriptionRepository.findSchoolById(schoolId);
  return {
    alreadyProcessed: false,
    subscriptionExpiryDate: updatedSchool.subscriptionExpiryDate,
  };
}

/**
 * WHAT: Returns one page of the requesting admin's school's completed
 *       renewal history — each past renewal's amount, plan, resulting
 *       expiry, and Razorpay ids.
 * WHY: Powers GET /api/admin/subscription/history — lets the dashboard show
 *      a timeline of renewals.
 *
 * DERIVING "resultingExpiryDate": each row's own resultingExpiryDate column
 * (PHASE 8E) is the accurate answer for every renewal completed after that
 * migration shipped. School itself only ever holds the CURRENT expiry
 * (overwritten by every renewal), so older renewals from BEFORE this
 * column existed show `resultingExpiryDate: null` — that information is
 * genuinely gone, not recoverable from any other existing data.
 *
 * @param {number} schoolId - from req.user.schoolId (JWT), never the client
 * @param {object} query - { page, limit } from req.query
 * RETURNS: Promise<{ renewals: object[], pagination: object }>
 */
async function getHistory(schoolId, query) {
  const { page, limit, skip } = parsePagination(query);

  // Run the page query and the total count in parallel — same pattern
  // notification.service.js already uses, halving the round-trip time
  // versus awaiting them one after another.
  const [payments, total] = await Promise.all([
    subscriptionRepository.findRenewalPaymentsBySchoolId(schoolId, skip, limit),
    subscriptionRepository.countRenewalPaymentsBySchoolId(schoolId),
  ]);

  // Batch-resolve every distinct planId on this page to its plan name in
  // ONE query, instead of one extra query PER payment row (no N+1) — see
  // findPlansByIds()'s own comment in subscription.repository.js.
  const planIds = [...new Set(payments.map((p) => p.planId).filter((id) => id != null))];
  const plans = planIds.length ? await subscriptionRepository.findPlansByIds(planIds) : [];
  const planNameById = new Map(plans.map((p) => [p.id, p.name]));

  const renewals = payments.map((p) => ({
    paymentId: p.id,
    amount: p.amount,
    currency: p.currency,
    plan: planNameById.get(p.planId) ?? null,
    resultingExpiryDate: p.resultingExpiryDate, // null for pre-8E renewals — see WHY above
    razorpayOrderId: p.razorpayOrderId,
    razorpayPaymentId: p.razorpayPaymentId,
    renewedAt: p.createdAt,
  }));

  return { renewals, pagination: buildPaginationMeta(page, limit, total) };
}

module.exports = {
  getStatus,
  createRenewOrder,
  renewVerify,
  completeRenewalForPayment,
  getHistory,
};
