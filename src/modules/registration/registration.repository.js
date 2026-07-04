/**
 * REGISTRATION REPOSITORY
 * ========================
 * All database calls for the "School Registration + Payment" flow live here.
 * registration.service.js calls these functions — it never talks to Prisma
 * directly. This keeps "what to do" (service) separate from "how to
 * fetch/save it" (repository), same pattern as auth.repository.js.
 *
 * Phase 1: PendingRegistration (temporary signup data), SubscriptionPlan (pricing)
 * Phase 2: Payment (Razorpay order tracking)
 * Phase 3: School + User — created ONLY here, ONLY after payment is verified
 *          (see createSchoolAndAdmin below). This is the one and only place
 *          in the whole app that creates a School or an admin User.
 */

const prisma = require("../../config/db");

// ─────────────────────────────────────────────
// SUBSCRIPTION PLAN
// ─────────────────────────────────────────────

/**
 * WHAT: Fetches every subscription plan that is currently active.
 * WHY: The public "choose a plan" screen must never show a plan that an
 *      admin has deactivated (e.g. a discontinued price point).
 * RETURNS: Promise<SubscriptionPlan[]> — ordered cheapest to most expensive.
 */
async function findActivePlans() {
  return prisma.subscriptionPlan.findMany({
    where: { isActive: true },
    orderBy: { price: "asc" },
  });
}

/**
 * WHAT: Fetches a single plan by its name (e.g. "1 Year").
 * WHY: When the frontend submits `selectedPlan` as a string, we need to look
 *      up its real price server-side — we never trust a price sent by the client.
 * RETURNS: Promise<SubscriptionPlan|null>
 */
async function findPlanByName(name) {
  return prisma.subscriptionPlan.findFirst({
    where: { name, isActive: true },
  });
}

// ─────────────────────────────────────────────
// PENDING REGISTRATION
// ─────────────────────────────────────────────

/**
 * WHAT: Creates a new PendingRegistration row for a school that just
 *       submitted the "school details" step of the signup form.
 * WHY: We need somewhere to hold the school's info + chosen plan while the
 *      admin details and payment steps are still in progress.
 * RETURNS: Promise<PendingRegistration> — the created row (includes tempId).
 */
async function createPendingRegistration({ tempId, schoolData, selectedPlan, planAmount, expiresAt }) {
  return prisma.pendingRegistration.create({
    data: {
      tempId,
      schoolData,
      selectedPlan,
      planAmount,
      status: "school_pending",
      expiresAt,
    },
  });
}

/**
 * WHAT: Finds a PendingRegistration row by its public tempId.
 * WHY: tempId (not the internal auto-increment `id`) is the only identifier
 *      ever exposed to the frontend, so every later step (admin-details,
 *      review) looks the row up this way.
 * RETURNS: Promise<PendingRegistration|null>
 */
async function findByTempId(tempId) {
  return prisma.pendingRegistration.findUnique({
    where: { tempId },
  });
}

/**
 * WHAT: Saves the admin's details onto an existing PendingRegistration row
 *       and flips its status to "ready".
 * WHY: This is step 2 of the signup form — once both school + admin data
 *      are present, the row is ready for the (future) payment step.
 * RETURNS: Promise<PendingRegistration> — the updated row.
 */
async function attachAdminData(tempId, adminData) {
  return prisma.pendingRegistration.update({
    where: { tempId },
    data: {
      adminData,
      status: "ready",
    },
  });
}

// ─────────────────────────────────────────────
// PAYMENT — PHASE 2
// ─────────────────────────────────────────────

/**
 * WHAT: Finds an existing Payment row for a tempId that is still in the
 *       "created" state (i.e. an order was made but never confirmed paid).
 * WHY: Powers the idempotent-retry check in registration.service.js — if the
 *      frontend calls create-order twice (e.g. user refreshes the checkout
 *      page), we reuse the same Razorpay order instead of creating a
 *      duplicate one.
 * RETURNS: Promise<Payment|null>
 */
async function findCreatedPaymentByTempId(tempId) {
  return prisma.payment.findFirst({
    where: { tempId, status: "created" },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * WHAT: Creates a new Payment row right after a Razorpay order is created.
 * WHY: This is our local record of "an order exists for this tempId" —
 *      Phase 3 will look this row up by razorpayOrderId to verify payment
 *      and flip status to "paid".
 * RETURNS: Promise<Payment> — the created row.
 */
async function createPayment({ tempId, razorpayOrderId, amount, currency }) {
  return prisma.payment.create({
    data: {
      tempId,
      razorpayOrderId,
      amount,
      currency,
      status: "created",
    },
  });
}

/**
 * WHAT: Finds a Payment row by its Razorpay order id.
 * WHY: verify-payment (Phase 3) receives razorpay_order_id from the
 *      frontend/Razorpay checkout callback and must look up OUR local
 *      Payment record to know which tempId it belongs to and what we
 *      expect to verify.
 * RETURNS: Promise<Payment|null>
 */
async function findPaymentByOrderId(razorpayOrderId) {
  return prisma.payment.findUnique({
    where: { razorpayOrderId },
  });
}

/**
 * WHAT: Marks a Payment row as "failed".
 * WHY: Called when Razorpay's signature check fails — we record the failed
 *      attempt but create NOTHING else (no School/User), so there's a clean
 *      audit trail of "this order was tampered with or the payment failed".
 * RETURNS: Promise<Payment> — the updated row.
 */
async function markPaymentFailed(razorpayOrderId) {
  return prisma.payment.update({
    where: { razorpayOrderId },
    data: { status: "failed" },
  });
}

// ─────────────────────────────────────────────
// SCHOOL / USER — PHASE 3 (pre-transaction collision checks)
// ─────────────────────────────────────────────

/**
 * WHAT: Finds a School by its domain.
 * WHY: School.domain is @unique — before opening a transaction we check for
 *      a collision so a duplicate signup fails with a clean, specific error
 *      instead of an opaque database constraint error mid-transaction.
 * RETURNS: Promise<School|null>
 */
async function findSchoolByDomain(domain) {
  return prisma.school.findUnique({
    where: { domain },
    select: { id: true },
  });
}

/**
 * WHAT: Finds a User by email.
 * WHY: User.email is @unique — same reasoning as findSchoolByDomain above,
 *      applied to the admin account we're about to create.
 * RETURNS: Promise<User|null>
 */
async function findUserByEmail(email) {
  return prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
}

// ─────────────────────────────────────────────
// SCHOOL / USER — PHASE 3 (atomic creation)
// ─────────────────────────────────────────────

/**
 * WHAT: Creates the real School + admin User, and marks the Payment/
 *       PendingRegistration as complete — all inside ONE database
 *       transaction.
 * WHY: This is the highest-risk write in the whole flow. If the server
 *      crashed or threw partway through (e.g. School created but User
 *      creation failed), we'd end up with a School that has no admin able
 *      to log into it — an unrecoverable broken state. Wrapping every write
 *      in prisma.$transaction() means either ALL of them succeed together,
 *      or (if any one throws) the database driver automatically rolls back
 *      EVERY write in the block, leaving zero partial rows behind.
 *
 *      We use the "interactive" callback form (not the array form) because
 *      step 2 (creating the User) needs `school.id`, which only exists
 *      after step 1 (creating the School) has actually run.
 *
 * @param {object} params
 * @param {object} params.schoolData      - { name, email, phone, domain, code, address, city, state, country, pincode }
 * @param {object} params.adminData       - { name, email, phone, passwordHash } (already bcrypt-hashed — Phase 1)
 * @param {string} params.selectedPlan    - plan name, e.g. "1 Year"
 * @param {number} params.planDurationMonths
 * @param {Date}   params.subscriptionStartDate
 * @param {Date}   params.subscriptionExpiryDate
 * @param {string} params.razorpayOrderId
 * @param {string} params.razorpayPaymentId
 * @param {string} params.razorpaySignature
 * @param {string} params.tempId
 * RETURNS: Promise<{ school: School, admin: User }>
 */
async function createSchoolAndAdmin({
  schoolData,
  adminData,
  selectedPlan,
  planDurationMonths,
  subscriptionStartDate,
  subscriptionExpiryDate,
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
  tempId,
}) {
  // prisma.$transaction(async (tx) => {...}) opens one database transaction
  // and gives us `tx` — a Prisma client whose queries all run inside it.
  // Nothing any of these queries write becomes permanent until the callback
  // finishes without throwing; if it throws, Prisma rolls everything back.
  return prisma.$transaction(async (tx) => {
    // 1. Create the real School row — this is the FIRST time this school exists.
    const school = await tx.school.create({
      data: {
        name: schoolData.name,
        domain: schoolData.domain,
        code: schoolData.code,
        address: schoolData.address,
        city: schoolData.city,
        state: schoolData.state,
        country: schoolData.country,
        pincode: schoolData.pincode,
        plan: selectedPlan,
        planDurationMonths,
        subscriptionStartDate,
        subscriptionExpiryDate,
        paymentStatus: "PAID",
        subscriptionStatus: "ACTIVE",
        razorpayOrderId,
        razorpayPaymentId,
      },
    });

    // 2. Create the admin User, linked to the School we just created.
    //    passwordHash is reused AS-IS from PendingRegistration.adminData —
    //    it was already bcrypt-hashed back in Phase 1. Hashing it again here
    //    would hash-the-hash, and the admin's real password would never
    //    match on login again.
    const admin = await tx.user.create({
      data: {
        schoolId: school.id,
        email: adminData.email,
        role: "admin",
        name: adminData.name,
        phoneNumber: adminData.phone,
        passwordHash: adminData.passwordHash,
        // Payment success is treated as proof the admin owns this email —
        // this signup flow has no separate OTP step, unlike student self-registration.
        emailVerified: true,
      },
    });

    // 3. Flip the Payment row to "paid" and store the proof-of-payment fields.
    await tx.payment.update({
      where: { razorpayOrderId },
      data: {
        status: "paid",
        razorpayPaymentId,
        razorpaySignature,
      },
    });

    // 4. Mark the PendingRegistration as fully completed — it has now done
    //    its job and produced a real School + User.
    await tx.pendingRegistration.update({
      where: { tempId },
      data: { status: "completed" },
    });

    return { school, admin };
  });
}

module.exports = {
  findActivePlans,
  findPlanByName,
  createPendingRegistration,
  findByTempId,
  attachAdminData,
  findCreatedPaymentByTempId,
  createPayment,
  findPaymentByOrderId,
  markPaymentFailed,
  findSchoolByDomain,
  findUserByEmail,
  createSchoolAndAdmin,
};
