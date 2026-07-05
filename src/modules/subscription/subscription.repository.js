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
 * WHAT: Finds an existing, still-unpaid renewal Payment for this school AND
 *       this exact plan (purpose="renewal", status="created", planId matches).
 * WHY: Idempotent-retry — same reasoning as registration's
 *      findCreatedPaymentByTempId(): if the admin calls renew-order twice
 *      for the SAME plan before paying (e.g. page refresh), we reuse the
 *      same Razorpay order instead of leaving multiple live unpaid orders open.
 *
 *      BUG FIX: this used to match by schoolId ONLY, so an old unpaid order
 *      for a DIFFERENT plan (e.g. abandoned "1 Year" checkout) got reused
 *      even when the admin picked a different plan (e.g. "6 Months") the
 *      next time — always returning the first plan's price. Filtering by
 *      planId too means a new plan choice always gets a fresh, correct order.
 * RETURNS: Promise<Payment|null>
 */
async function findCreatedRenewalPaymentBySchoolId(schoolId, planId) {
  return prisma.payment.findFirst({
    where: { schoolId, planId, purpose: "renewal", status: "created" },
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

/**
 * WHAT: Inside ONE transaction — flips the Payment to "paid" and writes the
 *       purchase into the QUEUE fields instead of touching the school's
 *       current plan/expiry/status.
 * WHY: Used when completeRenewalForPayment() (subscription.service.js)
 *      decides the school currently has an active plan — the purchase
 *      must wait until that plan expires (see activateQueuedPlanForSchool()
 *      below, called by the Phase 8D daily cron).
 *
 * IDEMPOTENCY: identical two-layer guard to completeRenewalTransaction()
 * above:
 *   1. The Payment update only matches rows NOT already "paid" — a second
 *      call (webhook after verify, or vice versa) sees count=0 and stops.
 *   2. The School update only matches rows where queuedPlan IS NULL — this
 *      guards the extremely narrow race where two separate queue-attempts
 *      both got past createRenewOrder()'s "you already have one queued"
 *      check before either wrote. If this guard fails (count=0), the
 *      payment still completes (money already moved — we never undo a
 *      successful charge) but the queue write is skipped; a loud console.error
 *      flags it for manual reconciliation, the same tradeoff Phase 8B
 *      accepted for a lost coupon-usedCount race.
 *
 * @param {object} params
 * @param {number} params.paymentId
 * @param {string} params.razorpayPaymentId
 * @param {number} params.schoolId
 * @param {string} params.planName
 * @param {number} params.planDurationMonths
 * @param {Date}   params.queueStartsAt - the CURRENT subscriptionExpiryDate
 *        at the moment of queueing (i.e. when this queued plan will start)
 * @param {Date}   params.queueExpiryDate - queueStartsAt + planDurationMonths,
 *        already computed by the caller — stored on Payment.resultingExpiryDate
 *        (same column meaning as the immediate-activate path: "what the
 *        expiry became because of this payment", just not applied to School yet)
 * RETURNS: Promise<{ school: School, alreadyProcessed: boolean }>
 */
async function completeQueueTransaction({
  paymentId,
  razorpayPaymentId,
  schoolId,
  planName,
  planDurationMonths,
  queueStartsAt,
  queueExpiryDate,
}) {
  return prisma.$transaction(async (tx) => {
    const paymentUpdate = await tx.payment.updateMany({
      where: { id: paymentId, status: { not: "paid" } },
      data: { status: "paid", razorpayPaymentId, resultingExpiryDate: queueExpiryDate },
    });

    if (paymentUpdate.count === 0) {
      const school = await tx.school.findUnique({ where: { id: schoolId } });
      return { school, alreadyProcessed: true };
    }

    // Conditional write — see IDEMPOTENCY note above for why `queuedPlan:
    // null` is part of the WHERE clause rather than a plain update.
    const queueWrite = await tx.school.updateMany({
      where: { id: schoolId, queuedPlan: null },
      data: {
        queuedPlan: planName,
        queuedPlanDurationMonths: planDurationMonths,
        queuedPlanStartsAt: queueStartsAt,
        queuedPaymentId: paymentId,
      },
    });

    if (queueWrite.count === 0) {
      console.error(
        `[subscription] Payment ${paymentId} for school ${schoolId} succeeded but the queue slot was ` +
          `already taken by a concurrent renewal — needs manual reconciliation (possible refund).`,
      );
    }

    const school = await tx.school.findUnique({ where: { id: schoolId } });
    return { school, alreadyProcessed: false };
  });
}

// ─────────────────────────────────────────────
// QUEUED-PLAN AUTO-ACTIVATION — reused by the Phase 8D daily cron
// (src/jobs/subscription-reminder.processor.js), not a new schedule.
// ─────────────────────────────────────────────

/**
 * WHAT: Finds every school whose current plan has expired AND that has a
 *       queued plan waiting.
 * WHY: Powers the cron step that auto-activates queued plans. One indexed
 *      range query (subscriptionExpiryDate already has an index on School)
 *      plus a null-check — never loads every school and filters in JS.
 * RETURNS: Promise<School[]>
 */
async function findSchoolsWithExpiredQueuedPlan() {
  return prisma.school.findMany({
    where: { subscriptionExpiryDate: { lt: new Date() }, queuedPlan: { not: null } },
    select: {
      id: true,
      queuedPlan: true,
      queuedPlanDurationMonths: true,
      queuedPlanStartsAt: true,
    },
  });
}

/**
 * WHAT: Atomically activates ONE school's queued plan — copies the queued
 *       fields onto the real plan/subscriptionStartDate/subscriptionExpiryDate/
 *       status columns and clears the queue back to null, in a single
 *       conditional UPDATE.
 * WHY: `where: { queuedPlan: { not: null } }` is the idempotency guard —
 *      once this UPDATE runs once, queuedPlan becomes null, so a second
 *      call (the cron running twice, or two overlapping worker instances)
 *      matches ZERO rows and does nothing. No separate "already activated"
 *      flag needed — clearing the queue field IS the marker.
 *
 * @param {object} school - one row from findSchoolsWithExpiredQueuedPlan()
 * @param {Date} newExpiryDate - already computed by the caller
 *        (queuedPlanStartsAt + queuedPlanDurationMonths — see
 *        subscription.service.js's activateQueuedPlans())
 * RETURNS: Promise<boolean> - true if THIS call actually activated it
 */
async function activateQueuedPlanForSchool(school, newExpiryDate) {
  const result = await prisma.school.updateMany({
    where: { id: school.id, queuedPlan: { not: null } },
    data: {
      plan: school.queuedPlan,
      planDurationMonths: school.queuedPlanDurationMonths,
      subscriptionStartDate: school.queuedPlanStartsAt,
      subscriptionExpiryDate: newExpiryDate,
      subscriptionStatus: "ACTIVE",
      paymentStatus: "PAID",
      queuedPlan: null,
      queuedPlanDurationMonths: null,
      queuedPlanStartsAt: null,
      queuedPaymentId: null,
    },
  });

  return result.count > 0;
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
  completeQueueTransaction,
  findSchoolsWithExpiredQueuedPlan,
  activateQueuedPlanForSchool,
  findRenewalPaymentsBySchoolId,
  countRenewalPaymentsBySchoolId,
  findPlansByIds,
};
