/**
 * SUBSCRIPTION REPOSITORY — PHASE 8C
 * =====================================
 * All direct Prisma calls for manual subscription renewal live here.
 * subscription.service.js calls these functions — it never talks to Prisma
 * directly (same service/repository split as every other module).
 *
 * Payment lookup-by-order-id is deliberately NOT duplicated here — we reuse
 * registration.repository.js's findPaymentByOrderId() instead, since a
 * renewal Payment row is stored in the exact same `payments` table.
 */

const prisma = require("../../config/db");

/**
 * WHAT: Fetches a School by its id.
 * WHY: Every renewal operation (status check, order creation, completion)
 *      needs the school's current plan/expiry/status fields.
 * RETURNS: Promise<School|null>
 */
async function findSchoolById(schoolId) {
  return prisma.school.findUnique({ where: { id: schoolId } });
}

/**
 * WHAT: Fetches a SubscriptionPlan by its numeric id (not by name — that's
 *       registration.repository.js's findPlanByName, used by the signup flow).
 * WHY: The renew-order endpoint takes { planId } in its body — we need the
 *      plan's true price + durationMonths server-side, never trusting
 *      anything the client sends beyond which plan id they picked.
 * RETURNS: Promise<SubscriptionPlan|null>
 */
async function findPlanById(planId) {
  return prisma.subscriptionPlan.findFirst({
    where: { id: planId, isActive: true },
  });
}

/**
 * WHAT: Finds an existing, still-unpaid renewal Payment for this school
 *       (purpose="renewal", status="created").
 * WHY: Idempotent-retry — same reasoning as registration's
 *      findCreatedPaymentByTempId(): if the admin calls renew-order twice
 *      before paying (e.g. page refresh), we reuse the same Razorpay order
 *      instead of leaving multiple live unpaid orders open.
 * RETURNS: Promise<Payment|null>
 */
async function findCreatedRenewalPaymentBySchoolId(schoolId) {
  return prisma.payment.findFirst({
    where: { schoolId, purpose: "renewal", status: "created" },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * WHAT: Creates a new Payment row for a renewal order.
 * WHY: Mirrors registration.repository.js's createPayment(), but for
 *      renewals: tempId is null (no PendingRegistration involved), schoolId
 *      + planId are set instead so the webhook path (which gets no request
 *      body) can later recompute exactly what plan/school this was for.
 * RETURNS: Promise<Payment>
 */
async function createRenewalPayment({ schoolId, planId, razorpayOrderId, amount, currency }) {
  return prisma.payment.create({
    data: {
      tempId: null,
      schoolId,
      planId,
      purpose: "renewal",
      razorpayOrderId,
      amount,
      currency,
      status: "created",
    },
  });
}

/**
 * WHAT: Inside ONE transaction — flips the Payment to "paid", extends the
 *       school's subscription expiry, switches its plan (if a different one
 *       was chosen), and marks it ACTIVE/PAID again.
 * WHY: This is the single atomic write for "a renewal really happened."
 *      Wrapping every write in prisma.$transaction() means either ALL of
 *      them land, or (if any one throws) NONE do — same reasoning as
 *      registration.repository.js's createSchoolAndAdmin(). The caller
 *      (subscription.service.js's completeRenewalForPayment) has ALREADY
 *      checked payment.status !== "paid" before calling this, so this is
 *      only ever reached once per real renewal.
 *
 * @param {object} params
 * @param {number} params.paymentId
 * @param {string} params.razorpayOrderId
 * @param {string} params.razorpayPaymentId
 * @param {number} params.schoolId
 * @param {string} params.planName - new plan's name, e.g. "1 Year"
 * @param {number} params.planDurationMonths
 * @param {Date}   params.newExpiryDate - already computed by the caller
 *        (see subscription.service.js for the before/after-expiry date math)
 * RETURNS: Promise<{ school: School }>
 */
async function completeRenewalTransaction({
  paymentId,
  razorpayOrderId,
  razorpayPaymentId,
  schoolId,
  planName,
  planDurationMonths,
  newExpiryDate,
}) {
  return prisma.$transaction(async (tx) => {
    // 1. Flip Payment to paid — this is also the idempotency guard: the
    //    caller only reaches this function once per payment, but the
    //    conditional updateMany (not a plain update) means that even if two
    //    callers somehow raced here, only the first would actually flip it.
    const paymentUpdate = await tx.payment.updateMany({
      where: { id: paymentId, status: { not: "paid" } },
      // PHASE 8E — resultingExpiryDate records what the school's expiry
      // BECAME because of this specific renewal — School itself only ever
      // holds the current expiry (overwritten by every later renewal), so
      // this is the only place that date survives for admin.subscription
      // history to read back later.
      data: { status: "paid", razorpayPaymentId, resultingExpiryDate: newExpiryDate },
    });

    // If another concurrent call already flipped this payment to "paid"
    // (e.g. verify-payment and the webhook arriving at almost the same
    // instant), stop here — the OTHER call is the one extending the
    // subscription; this one must not do it a second time.
    if (paymentUpdate.count === 0) {
      const school = await tx.school.findUnique({ where: { id: schoolId } });
      return { school, alreadyProcessed: true };
    }

    // 2. Extend the school's subscription — plan/duration/expiry/status all
    //    updated together so the row is never left in a half-updated state.
    const school = await tx.school.update({
      where: { id: schoolId },
      data: {
        plan: planName,
        planDurationMonths,
        subscriptionExpiryDate: newExpiryDate,
        subscriptionStatus: "ACTIVE",
        paymentStatus: "PAID",
        razorpayOrderId,
        razorpayPaymentId,
      },
    });

    return { school, alreadyProcessed: false };
  });
}

// ─────────────────────────────────────────────
// RENEWAL HISTORY — PHASE 8E (admin dashboard)
// ─────────────────────────────────────────────

/**
 * WHAT: Fetches one page of a school's COMPLETED renewal payments, newest
 *       first.
 * WHY: Powers GET /api/admin/subscription/history. Only status="paid" rows
 *      are included — an abandoned/failed renewal attempt never changed
 *      the subscription, so it doesn't belong in a "what happened to my
 *      subscription" timeline. `select` pulls only the columns the
 *      dashboard actually needs (never razorpaySignature, an internal
 *      verification detail).
 * RETURNS: Promise<Payment[]>
 */
async function findRenewalPaymentsBySchoolId(schoolId, skip, limit) {
  return prisma.payment.findMany({
    where: { schoolId, purpose: "renewal", status: "paid" },
    orderBy: { createdAt: "desc" },
    skip,
    take: limit,
    select: {
      id: true,
      amount: true,
      currency: true,
      planId: true,
      resultingExpiryDate: true,
      razorpayOrderId: true,
      razorpayPaymentId: true,
      createdAt: true,
    },
  });
}

/**
 * WHAT: Counts a school's total completed renewals — pagination metadata
 *       for the history list above.
 * RETURNS: Promise<number>
 */
async function countRenewalPaymentsBySchoolId(schoolId) {
  return prisma.payment.count({
    where: { schoolId, purpose: "renewal", status: "paid" },
  });
}

/**
 * WHAT: Batch-resolves a list of SubscriptionPlan ids to their names in ONE
 *       query, e.g. [2, 1, 2] -> [{id:2,name:"1 Year"}, {id:1,name:"6 Months"}].
 * WHY: Payment only stores planId, not the plan's name — this lets
 *      subscription.service.js attach a human-readable plan name to every
 *      history row without a separate query PER row (no N+1).
 * RETURNS: Promise<SubscriptionPlan[]> (only id + name selected)
 */
async function findPlansByIds(planIds) {
  return prisma.subscriptionPlan.findMany({
    where: { id: { in: planIds } },
    select: { id: true, name: true },
  });
}

module.exports = {
  findSchoolById,
  findPlanById,
  findCreatedRenewalPaymentBySchoolId,
  createRenewalPayment,
  completeRenewalTransaction,
  findRenewalPaymentsBySchoolId,
  countRenewalPaymentsBySchoolId,
  findPlansByIds,
};
