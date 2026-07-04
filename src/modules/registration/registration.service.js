/**
 * REGISTRATION SERVICE — PHASE 1 + PHASE 2 + PHASE 3 + PHASE 4
 * =========================================================================
 * Business logic for the "School Registration + Payment" flow.
 *
 * Phase 1 (Plans + Temporary Registration Storage): no Razorpay, no
 * School/User creation — just stores signup data temporarily in
 * PendingRegistration while the multi-step form is filled out.
 *
 * Phase 2 (Razorpay Order Creation, TEST MODE): creates a Razorpay order
 * for a PendingRegistration that's ready for payment. Still no School/User
 * creation, and no payment *verification* yet — that's Phase 3.
 *
 * Phase 3 (Payment Verification + Atomic School/Admin Creation): verifies
 * the Razorpay signature, then creates the real School + admin User in one
 * transaction.
 *
 * Phase 4 (this addition — Invoice PDF + Email): after Phase 3 commits,
 * enqueues a background job to generate an invoice PDF and email it to the
 * admin. Fire-and-forget — never blocks or breaks the verify-payment response.
 *
 * registration.controller.js calls these functions; this file calls
 * registration.repository.js — it never touches Prisma directly (same
 * layering as auth.service.js / auth.repository.js).
 */

const crypto = require("crypto");
const registrationRepository = require("./registration.repository");
const { hashPassword } = require("../../utils/hash"); // bcrypt wrapper — see utils/hash.js
const razorpay = require("../../config/razorpay"); // shared Razorpay client — see config/razorpay.js
const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET, LOGIN_URL } = require("../../config/env");
const { enqueueGenerateInvoice } = require("../../queues/invoice.queue");
const { calculateGst } = require("../../utils/gst"); // shared base→CGST/SGST/total split — see utils/gst.js
const couponService = require("../coupons/coupon.service"); // PHASE 8B — shared coupon validation + discount math
const couponRepository = require("../coupons/coupon.repository"); // PHASE 8B — raw coupon lookup at payment-completion time (see completeRegistrationForPayment)

// How long a PendingRegistration stays valid before the tempId is considered dead.
const REGISTRATION_EXPIRY_MINUTES = 30;

/**
 * WHAT: Returns "now + 30 minutes" as a Date object.
 * WHY: Every PendingRegistration needs an expiry so an abandoned signup
 *      can't be resumed forever (and so the future cleanup cron has
 *      something to filter on).
 * RETURNS: Date
 */
function getRegistrationExpiry() {
  return new Date(Date.now() + REGISTRATION_EXPIRY_MINUTES * 60 * 1000);
}

/**
 * WHAT: Checks whether a PendingRegistration row has passed its expiresAt.
 * WHY: Centralizes the expiry check so every endpoint (admin-details,
 *      review) enforces the same rule instead of repeating `< new Date()`.
 * RETURNS: boolean — true if expired.
 */
function isExpired(pendingRegistration) {
  return pendingRegistration.expiresAt < new Date();
}

/**
 * WHAT: Returns all subscription plans a school can pick during signup.
 * WHY: Powers GET /api/registration/plans — the frontend renders these as
 *      pricing cards before the user fills in school details.
 * RETURNS: Promise<SubscriptionPlan[]>
 */
async function listPlans() {
  return registrationRepository.findActivePlans();
}

/**
 * WHAT: Validates + stores step 1 of the signup form (school details +
 *       chosen plan), and creates a PendingRegistration row for it.
 * WHY: The frontend needs a `tempId` to carry across steps 2 (admin details)
 *      and 3 (review/payment) without creating a real School yet.
 *
 * @param {object} schoolFields - name, email, phone, domain, code, address,
 *                                city, state, country, pincode
 * @param {string} selectedPlan - plan name, must match an active SubscriptionPlan
 * RETURNS: Promise<{ tempId: string, expiresAt: Date }>
 */
async function submitSchoolDetails(schoolFields, selectedPlan) {
  // Look up the plan server-side — we NEVER trust a price sent by the client,
  // only the plan *name* they picked. This stops someone from tampering with
  // the request to register for ₹1 instead of the real price.
  const plan = await registrationRepository.findPlanByName(selectedPlan);
  if (!plan) {
    const err = new Error(`"${selectedPlan}" is not a valid or active plan`);
    err.statusCode = 400;
    throw err;
  }

  // crypto.randomUUID() is a built-in Node function (no extra package needed)
  // that generates a random v4 UUID, e.g. "3fa85f64-5717-4562-b3fc-2c963f66afa6".
  // We use this as the public tempId instead of the internal auto-increment id,
  // so the frontend can never guess/enumerate other people's registrations.
  const tempId = crypto.randomUUID();

  const pendingRegistration = await registrationRepository.createPendingRegistration({
    tempId,
    schoolData: schoolFields,
    selectedPlan: plan.name,
    planAmount: plan.price,
    expiresAt: getRegistrationExpiry(),
  });

  return {
    tempId: pendingRegistration.tempId,
    expiresAt: pendingRegistration.expiresAt,
  };
}

/**
 * WHAT: Validates + stores step 2 of the signup form (admin details) onto
 *       an existing PendingRegistration, and marks it "ready".
 * WHY: Splits the form into steps without ever creating a real User —
 *      the password is hashed now so it's never sitting in plain text,
 *      even temporarily, but the actual User row is created in a later phase.
 *
 * @param {string} tempId
 * @param {object} adminFields - name, email, phone, password
 * RETURNS: Promise<{ tempId: string, status: string }>
 */
async function submitAdminDetails(tempId, adminFields) {
  const pendingRegistration = await registrationRepository.findByTempId(tempId);

  if (!pendingRegistration) {
    const err = new Error("Registration session not found. Please start over.");
    err.statusCode = 404;
    throw err;
  }

  if (isExpired(pendingRegistration)) {
    const err = new Error("This registration session has expired. Please start over.");
    err.statusCode = 410; // 410 Gone — the resource existed but is no longer valid
    throw err;
  }

  // bcrypt.hash() (wrapped by hashPassword) turns the plain-text password into
  // a one-way hash + salt. Even though this is "just" temporary storage, the
  // password must never sit in the database in a readable form.
  const passwordHash = await hashPassword(adminFields.password);

  const adminData = {
    name: adminFields.name,
    email: adminFields.email,
    phone: adminFields.phone,
    passwordHash,
  };

  const updated = await registrationRepository.attachAdminData(tempId, adminData);

  return {
    tempId: updated.tempId,
    status: updated.status,
  };
}

/**
 * WHAT: Builds the confirmation-screen summary for a given tempId — the
 *       school details, admin details (minus the password hash), and the
 *       selected plan + amount.
 * WHY: Powers GET /api/registration/review/:tempId, the last screen before
 *      payment (a later phase) — the user reviews everything they entered.
 *
 * @param {string} tempId
 * RETURNS: Promise<object> combined summary
 */
async function getRegistrationSummary(tempId) {
  const pendingRegistration = await registrationRepository.findByTempId(tempId);

  if (!pendingRegistration) {
    const err = new Error("Registration session not found. Please start over.");
    err.statusCode = 404;
    throw err;
  }

  if (isExpired(pendingRegistration)) {
    const err = new Error("This registration session has expired. Please start over.");
    err.statusCode = 410;
    throw err;
  }

  if (!pendingRegistration.adminData) {
    const err = new Error("Admin details have not been submitted yet.");
    err.statusCode = 400;
    throw err;
  }

  // Strip passwordHash before it ever leaves the service layer — the review
  // screen shows the admin's name/email/phone, never the hash.
  const { passwordHash, ...adminDataWithoutPassword } = pendingRegistration.adminData;

  return {
    tempId: pendingRegistration.tempId,
    school: pendingRegistration.schoolData,
    admin: adminDataWithoutPassword,
    plan: {
      name: pendingRegistration.selectedPlan,
      amount: pendingRegistration.planAmount,
    },
    status: pendingRegistration.status,
    expiresAt: pendingRegistration.expiresAt,
  };
}

/**
 * WHAT: Validates a coupon code against a PendingRegistration's plan price,
 *       stores it on that row for later use by createOrder(), and returns a
 *       full price-breakdown preview for the review screen.
 * WHY: Powers POST /api/registration/apply-coupon. This does NOT touch
 *      Coupon.usedCount — a coupon is only ever actually "spent" once a
 *      payment completes (see completeRegistrationForPayment below), so the
 *      user can preview/swap coupons freely without consuming redemptions.
 *
 * MONEY FLOW: base → apply coupon → discountedBase → calculateGst(discountedBase)
 *             → total = discountedBase + gst
 * (see coupon.service.js's computeDiscount() for the full discount math.)
 *
 * @param {string} tempId
 * @param {string} code - raw coupon code as typed by the user (case-insensitive)
 * RETURNS: Promise<object> - price breakdown for the review screen
 */
async function applyCoupon(tempId, code) {
  const pendingRegistration = await registrationRepository.findByTempId(tempId);

  if (!pendingRegistration) {
    const err = new Error("Registration session not found. Please start over.");
    err.statusCode = 404;
    throw err;
  }

  if (isExpired(pendingRegistration)) {
    const err = new Error("This registration session has expired. Please start over.");
    err.statusCode = 410;
    throw err;
  }

  // The plan's true base price, from OUR OWN stored planAmount — never from
  // anything the client sends (same rule createOrder() follows below).
  const originalBaseAmount = pendingRegistration.planAmount;

  // Runs every validity rule (isActive, validFrom/validUntil, usedCount vs
  // maxUses) and computes the discount — throws a clear error if the coupon
  // can't be used. Does NOT increment usedCount (see WHY above).
  const { discountAmount, discountedBase, coupon } = await couponService.validateAndApplyCoupon(
    code,
    originalBaseAmount,
  );

  // Store the (normalized, uppercase) coupon code on the PendingRegistration
  // so createOrder() knows which coupon to re-validate and charge against.
  await registrationRepository.attachCouponToPendingRegistration(tempId, coupon.code);

  // GST is computed on the DISCOUNTED base, not the original price — correct
  // Indian GST treatment (tax applies to the actual taxable value after discount).
  const gst = calculateGst(discountedBase);

  return {
    tempId,
    coupon: {
      code: coupon.code,
      type: coupon.type,
      value: coupon.value,
    },
    originalBaseAmount,
    discountAmount,
    discountedBase,
    gstRate: gst.gstRate,
    cgstAmount: gst.cgstAmount,
    sgstAmount: gst.sgstAmount,
    totalAmount: gst.totalAmount, // discountedBase + GST — the new amount payable
  };
}

// TODO (later, not part of Phase 1): add a cron job (node-cron is already a
// dependency) that periodically runs something like:
//   prisma.pendingRegistration.deleteMany({ where: { expiresAt: { lt: new Date() } } })
// to purge expired/abandoned registrations so the table doesn't grow forever.

/**
 * WHAT: Converts a rupee amount into paise (the smallest Indian currency unit).
 * WHY: Razorpay's API always expects `amount` in the smallest currency unit —
 *      for INR that's paise, so ₹100 must be sent as 10000. Math.round()
 *      avoids floating-point weirdness (e.g. 4999 * 100 could come out as
 *      499899.9999999999 in rare cases) before Razorpay sees the number.
 * RETURNS: number (integer paise)
 */
function rupeesToPaise(rupees) {
  return Math.round(rupees * 100);
}

/**
 * WHAT: Creates a Razorpay order for a PendingRegistration that has finished
 *       both signup steps, saving a local Payment row to track it.
 * WHY: Powers POST /api/registration/create-order — the checkout screen
 *      needs a Razorpay order id + the public key id to open the Razorpay
 *      payment widget. No School/User is created here; that only happens
 *      in Phase 3 after the payment is verified.
 *
 * IDEMPOTENCY: if a Payment for this tempId already exists with
 * status "created" (e.g. the user refreshed the checkout page before
 * paying), we return that same order instead of creating a second one with
 * Razorpay — this avoids leaving multiple live orders open for one signup.
 *
 * PHASE 7 — PAYMENT RETRY, TRACED:
 *   - If a previous attempt FAILED (bad signature → markPaymentFailed sets
 *     Payment.status = "failed"), that row no longer matches the "created"
 *     lookup above, so this correctly creates a FRESH order + Payment row
 *     for the retry — the failed row stays behind purely as a historical
 *     audit trail. This is intentional, not a bug: a failed/tampered
 *     attempt should never be silently reusable.
 *   - If payment already SUCCEEDED (Payment.status = "paid"), PendingRegistration.status
 *     was flipped to "completed" in the same transaction (see
 *     createSchoolAndAdmin) — and the `status !== "ready"` check below
 *     already rejects any further create-order calls for that tempId, so a
 *     completed registration can never accidentally get a second order.
 *   - KNOWN NARROW EDGE CASE: two literally-simultaneous create-order calls
 *     for the same brand-new tempId (before any Payment row exists yet)
 *     could both pass the "no existing created Payment" check below and
 *     each create a separate Razorpay order + Payment row. This cannot
 *     produce a duplicate School/User (that's guarded separately in
 *     completeRegistrationForPayment), only, in the rare double-click case,
 *     a harmless spare unpaid order/Payment pair. Not fixed here — the
 *     Phase 7 rate limiter (5/min on this route) already makes the window
 *     to hit this vanishingly small, and closing it fully would need
 *     locking that isn't worth the added complexity for this outcome.
 *
 * @param {string} tempId
 * RETURNS: Promise<{ razorpayOrderId, amount, currency, keyId }>
 *          `amount` here is in paise (what the Razorpay frontend widget expects).
 */
async function createOrder(tempId) {
  const pendingRegistration = await registrationRepository.findByTempId(tempId);

  if (!pendingRegistration) {
    const err = new Error("Registration session not found. Please start over.");
    err.statusCode = 404;
    throw err;
  }

  if (isExpired(pendingRegistration)) {
    const err = new Error("This registration session has expired. Please start over.");
    err.statusCode = 410;
    throw err;
  }

  // Payment can only be started once admin-details (step 2) is done — that's
  // the point at which status flips to "ready" in submitAdminDetails() above.
  if (pendingRegistration.status !== "ready") {
    const err = new Error(
      "Admin details must be submitted before payment can be started.",
    );
    err.statusCode = 400;
    throw err;
  }

  // ── Idempotent retry: reuse an existing unpaid order instead of making a new one ──
  const existingPayment = await registrationRepository.findCreatedPaymentByTempId(tempId);
  if (existingPayment) {
    return {
      razorpayOrderId: existingPayment.razorpayOrderId,
      amount: rupeesToPaise(existingPayment.amount),
      currency: existingPayment.currency,
      keyId: RAZORPAY_KEY_ID,
    };
  }

  // Base amount is computed from OUR OWN stored planAmount — never from
  // anything the client sends — so a tampered request can't pay less than
  // the real price.
  let baseForGst = pendingRegistration.planAmount;

  // PHASE 8B — COUPONS: if the user applied a coupon earlier (apply-coupon
  // endpoint stored its code on this PendingRegistration), re-validate it
  // HERE, right before charging — it may have expired, been deactivated, or
  // hit its usage limit in the time between "apply" and "pay". If it's no
  // longer valid, we fail create-order with a clear message rather than
  // silently charging the un-discounted price the user didn't expect.
  if (pendingRegistration.couponCode) {
    const { discountedBase } = await couponService.validateAndApplyCoupon(
      pendingRegistration.couponCode,
      pendingRegistration.planAmount,
    );
    baseForGst = discountedBase;
  }

  // PHASE 8A — GST: the customer must actually pay base + GST, not just the
  // bare plan price, so calculateGst() (utils/gst.js) turns the base price
  // into the real amount Razorpay should charge. This is the ONE spot where
  // the Razorpay order total changed from "bare plan price" to
  // "plan price + 18% GST" — Payment.amount below now stores that same
  // GST-inclusive total, since Payment should reflect what was actually charged.
  //
  // PHASE 8B — when a coupon applied, baseForGst is already the DISCOUNTED
  // base (set above) — GST is computed on that, never on the original price.
  const { totalAmount } = calculateGst(baseForGst);
  const amountInPaise = rupeesToPaise(totalAmount);

  let razorpayOrder;
  try {
    // razorpay.orders.create() calls Razorpay's REST API to open a new order.
    // `receipt` is just our own reference string that shows up in the
    // Razorpay dashboard — it doesn't affect payment behavior.
    razorpayOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: "INR",
      receipt: `reg_${tempId}`,
    });
  } catch (razorpayErr) {
    const err = new Error("Failed to create payment order. Please try again.");
    err.statusCode = 500;
    throw err;
  }

  const payment = await registrationRepository.createPayment({
    tempId,
    razorpayOrderId: razorpayOrder.id,
    amount: totalAmount, // GST-inclusive total, in rupees — what Razorpay actually charges
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
 * WHAT: Computes "now + N months" as a Date object.
 * WHY: A school's subscription runs for however many months its plan
 *      covers (e.g. "1 Year" = 12 months) — this turns that into a concrete
 *      expiry timestamp starting from the moment payment is verified.
 * RETURNS: Date
 */
function addMonths(date, months) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

/**
 * WHAT: Verifies a Razorpay signature came from Razorpay (not a forged
 *       request), using the same HMAC-SHA256 algorithm Razorpay uses to sign.
 * WHY: This is the ONLY trustworthy proof that a payment really succeeded.
 *      A frontend could always lie and say "payment succeeded!" even if it
 *      didn't — but it can't forge this signature without our secret key,
 *      because Razorpay computes it server-side with the same secret and
 *      the frontend never sees the secret.
 *
 *      crypto.createHmac("sha256", secret) creates an HMAC (Hash-based
 *      Message Authentication Code) generator — like a hash, but seeded
 *      with a secret key so only someone who knows the secret can produce
 *      a matching output for given input.
 *
 *      crypto.timingSafeEqual() compares two buffers in CONSTANT time
 *      (i.e. the same number of CPU cycles regardless of where they first
 *      differ). A normal `===` string comparison exits as soon as it finds
 *      a mismatched character, which leaks (via response timing) how many
 *      leading characters were correct — letting an attacker guess the
 *      correct signature one character at a time. timingSafeEqual closes
 *      that side-channel.
 *
 * @param {string} orderId    - razorpay_order_id from the request
 * @param {string} paymentId  - razorpay_payment_id from the request
 * @param {string} signature  - razorpay_signature from the request
 * RETURNS: boolean — true if the signature is genuine.
 */
function isValidRazorpaySignature(orderId, paymentId, signature) {
  const expectedSignature = crypto
    .createHmac("sha256", RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  const actualBuffer = Buffer.from(signature, "hex");

  // timingSafeEqual throws if the two buffers have different lengths, so we
  // guard that first — a length mismatch just means "not equal", not a crash.
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

/**
 * WHAT: Given a Payment row that is CONFIRMED genuine (caller already
 *       verified it, one way or another), finishes the registration:
 *       loads the PendingRegistration, checks it's still valid, checks for
 *       domain/email collisions, computes subscription dates, creates the
 *       real School + admin User in one transaction, and enqueues the
 *       invoice job.
 * WHY: This is Phase 3's core logic, pulled out (Phase 5) so it can be
 *      shared by BOTH ways a payment can be confirmed:
 *        1. The frontend calling POST /verify-payment right after checkout.
 *        2. Razorpay's server-to-server webhook (Phase 5's safety net, for
 *           when the frontend never gets to call verify-payment — closed
 *           tab, network drop, etc.).
 *      Whichever one gets here FIRST does the real work; the other is
 *      naturally a no-op because Payment.status is already "paid" by the
 *      time it looks (see the idempotency checks in each caller).
 *
 *      IMPORTANT: this function does NOT verify any signature itself — by
 *      the time it's called, the caller has ALREADY proven the payment is
 *      real (checkout signature for verifyPayment, webhook signature for
 *      the webhook). This function only ever runs for a Payment that isn't
 *      already "paid".
 *
 * @param {object} payment - the local Payment row (from findPaymentByOrderId)
 * @param {object} confirmedBy
 * @param {string} confirmedBy.razorpayPaymentId
 * @param {string|null} confirmedBy.razorpaySignature - the checkout signature,
 *        or null when called from the webhook (webhooks don't carry that
 *        field — their own raw-body signature is the proof of authenticity instead)
 * RETURNS: Promise<{ school: School, admin: User }>
 */
async function completeRegistrationForPayment(payment, { razorpayPaymentId, razorpaySignature }) {
  // 1. Load the PendingRegistration this payment belongs to.
  const pendingRegistration = await registrationRepository.findByTempId(payment.tempId);

  if (!pendingRegistration) {
    const err = new Error("Registration session not found. Please start over.");
    err.statusCode = 410;
    throw err;
  }

  if (isExpired(pendingRegistration)) {
    const err = new Error("This registration session has expired. Please start over.");
    err.statusCode = 410;
    throw err;
  }

  // 2. Pre-transaction collision checks — fail fast with a clear error
  //    instead of letting a unique-constraint violation blow up mid-transaction.
  const domain = pendingRegistration.schoolData.domain;
  const adminEmail = pendingRegistration.adminData.email;

  const [existingSchool, existingUser] = await Promise.all([
    registrationRepository.findSchoolByDomain(domain),
    registrationRepository.findUserByEmail(adminEmail),
  ]);

  if (existingSchool) {
    const err = new Error(`A school with domain "${domain}" is already registered.`);
    err.statusCode = 409;
    throw err;
  }

  if (existingUser) {
    const err = new Error(`An account with email "${adminEmail}" already exists.`);
    err.statusCode = 409;
    throw err;
  }

  // 3. Compute subscription dates from the plan's duration.
  const plan = await registrationRepository.findPlanByName(pendingRegistration.selectedPlan);
  if (!plan) {
    const err = new Error("The selected plan is no longer available.");
    err.statusCode = 400;
    throw err;
  }

  const subscriptionStartDate = new Date();
  const subscriptionExpiryDate = addMonths(subscriptionStartDate, plan.durationMonths);

  // 3.5. PHASE 8B — re-derive the coupon discount for the Invoice + consume
  //      one use of the coupon. We deliberately do NOT re-run validity
  //      checks here (isActive/expiry/maxUses) — createOrder() already did
  //      that right before Razorpay charged the discounted total, and the
  //      customer's money has already moved. Re-validating now could reject
  //      an already-paid registration just because the coupon's status
  //      changed afterward, which would be the wrong outcome. We only need:
  //        (a) the same discount math, to record accurate Invoice numbers, and
  //        (b) the coupon's id + maxUses, to atomically consume a use below.
  let appliedCoupon = null; // passed to createSchoolAndAdmin for the atomic increment
  let originalBaseAmount = pendingRegistration.planAmount; // the true, pre-discount base
  let discountAmount = 0;
  let discountedBaseAmount = pendingRegistration.planAmount;

  if (pendingRegistration.couponCode) {
    const coupon = await couponRepository.findByCode(pendingRegistration.couponCode);

    // Extremely unlikely, but if the coupon row was hard-deleted between
    // apply/pay and now, there's nothing left to consume or record against —
    // we simply fall back to "no discount" rather than failing an
    // already-paid registration over a missing admin-management row.
    if (coupon) {
      const discount = couponService.computeDiscount(coupon, pendingRegistration.planAmount);
      discountAmount = discount.discountAmount;
      discountedBaseAmount = discount.discountedBase;
      appliedCoupon = { id: coupon.id, maxUses: coupon.maxUses };
    }
  }

  // 4. Create School + admin User atomically — see createSchoolAndAdmin's
  //    own comment in registration.repository.js for why this MUST be one transaction.
  let result;
  try {
    result = await registrationRepository.createSchoolAndAdmin({
      schoolData: pendingRegistration.schoolData,
      adminData: pendingRegistration.adminData,
      selectedPlan: pendingRegistration.selectedPlan,
      planDurationMonths: plan.durationMonths,
      subscriptionStartDate,
      subscriptionExpiryDate,
      razorpayOrderId: payment.razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      tempId: payment.tempId,
      appliedCoupon,
    });

    // Coupon usage was consumed inside the transaction above. If it came
    // back false (maxUses hit by a concurrent redemption in the narrow
    // window between createOrder() and this transaction), the school was
    // still created successfully — we just log it so it's visible, rather
    // than silently under-counting redemptions with no trace.
    if (appliedCoupon && !result.couponConsumed) {
      console.error(
        `Coupon "${pendingRegistration.couponCode}" usage was NOT recorded for school ${result.school.id} — maxUses limit was already reached by a concurrent redemption. The discounted payment still succeeded.`,
      );
    }
  } catch (transactionErr) {
    // PHASE 7 — RACE CONDITION HARDENING:
    // The pre-check above (findSchoolByDomain / findUserByEmail) handles the
    // common case fast and with a friendly message, but it runs BEFORE the
    // transaction — two requests for the same domain/email could both pass
    // that check at nearly the same instant, and only ONE of the two
    // transactions can actually win (School.domain and User.email are real
    // unique indexes in the database). The loser's transaction throws a
    // Prisma error with code "P2002" (unique constraint violation) instead
    // of silently corrupting anything — Prisma's $transaction still rolls
    // that loser's attempt back completely, so no partial rows are ever
    // left behind either way.
    //
    // "P2002" is Prisma's own error code for "a unique constraint was
    // violated" — checking transactionErr.code lets us tell this specific,
    // expected race apart from a genuinely unexpected failure (e.g. the
    // database connection dropping mid-transaction).
    if (transactionErr.code === "P2002") {
      // meta.target is normally an array of the column name(s) that
      // collided, e.g. ["domain"] or ["email"] — Prisma fills this in for
      // us from the underlying database error.
      const target = Array.isArray(transactionErr.meta?.target)
        ? transactionErr.meta.target.join(", ")
        : "domain or email";

      const err = new Error(
        `A school or admin account with this ${target} was just registered. Please contact support if this wasn't you.`,
      );
      err.statusCode = 409;
      throw err;
    }

    // Anything else is a genuinely unexpected failure (e.g. a dropped DB
    // connection mid-transaction). The transaction already rolled back
    // automatically — no partial rows exist. We just surface a clean,
    // generic error to the caller.
    const err = new Error("Failed to finalize registration. Please contact support.");
    err.statusCode = 500;
    throw err;
  }

  // Phase 4: invoice + email
  //
  // Enqueue a background job to generate the invoice PDF and email it to
  // the admin — this happens in the separate worker process (src/worker.js),
  // completely outside this HTTP request/response cycle. We deliberately do
  // NOT wait for the PDF/email to finish here (only for the .add() call
  // itself, which just pushes a message onto Redis and returns almost
  // instantly) — the school is already fully registered and paid for at
  // this point, so nothing about invoicing should be able to delay or
  // break the success response the caller (verify-payment OR the webhook)
  // is about to send.
  //
  // The try/catch means even if Redis itself is unreachable when we try to
  // enqueue, this still returns success — we just log the problem. A
  // missing invoice is recoverable later; an unpaid/uncreated school would not be.
  //
  // PHASE 7 AUDIT NOTE: this is the one spot in the whole flow where a
  // failure doesn't leave a "partial row" but DOES leave something silently
  // missing — if this .add() call itself fails (e.g. Redis briefly
  // unreachable), no Invoice row and no queued job exist at all, so BullMQ's
  // own retry logic never kicks in (it only retries jobs that made it onto
  // the queue). Every other failure branch in this file was traced and
  // confirmed to leave zero partial School/User/Payment/Invoice rows —
  // Prisma's $transaction above guarantees that atomically. This one
  // remaining gap is intentionally left as-is for now (recoverable via a
  // manual invoice run later) rather than adding extra machinery here.
  try {
    // PHASE 8B — pass the coupon breakdown through to the invoice job so it
    // can record couponCode/discountAmount/originalBaseAmount on the Invoice
    // and compute GST on the DISCOUNTED base, instead of re-deriving (or
    // guessing) the discount later. These are all null/0 when no coupon applied.
    await enqueueGenerateInvoice({
      schoolId: result.school.id,
      paymentId: payment.id,
      couponCode: pendingRegistration.couponCode || null,
      discountAmount,
      originalBaseAmount,
      discountedBaseAmount,
    });
  } catch (enqueueErr) {
    console.error(
      `Failed to enqueue invoice generation for school ${result.school.id}:`,
      enqueueErr.message,
    );
  }

  return result;
}

/**
 * WHAT: Verifies a Razorpay payment (checkout flow) and, only if genuine,
 *       completes the registration.
 * WHY: Powers POST /api/registration/verify-payment. This is the primary,
 *      fast path — called by the frontend right after Razorpay's checkout
 *      widget reports success. Phase 5 added a second, backup path (the
 *      webhook, see handleWebhookPaymentCaptured below) for when this never
 *      gets called.
 *
 * @param {object} params
 * @param {string} params.razorpayOrderId
 * @param {string} params.razorpayPaymentId
 * @param {string} params.razorpaySignature
 * RETURNS: Promise<{ schoolId, adminEmail, loginUrl, alreadyProcessed }>
 */
async function verifyPayment({ razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
  // 1. Find our local Payment record for this order.
  const payment = await registrationRepository.findPaymentByOrderId(razorpayOrderId);

  if (!payment) {
    const err = new Error("Payment order not found.");
    err.statusCode = 404;
    throw err;
  }

  // 2. Idempotency: if we already marked this paid, don't redo any work or
  //    create a second School/User for the same order — just confirm success.
  //    (e.g. the checkout callback and the webhook could both reach here —
  //    whichever runs second finds status already "paid" and stops here.)
  if (payment.status === "paid") {
    const pendingRegistration = await registrationRepository.findByTempId(payment.tempId);
    const domain = pendingRegistration?.schoolData?.domain;
    const school = domain ? await registrationRepository.findSchoolByDomain(domain) : null;

    return {
      schoolId: school?.id ?? null,
      adminEmail: pendingRegistration?.adminData?.email ?? null,
      loginUrl: LOGIN_URL,
      alreadyProcessed: true,
    };
  }

  // 3. Verify the CHECKOUT signature — the ONLY source of truth for "did
  //    this payment really happen," from the frontend's point of view. We
  //    never trust a client claiming "payment succeeded."
  const signatureIsValid = isValidRazorpaySignature(
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
  );

  if (!signatureIsValid) {
    // Record the failed attempt, but create NOTHING else.
    await registrationRepository.markPaymentFailed(razorpayOrderId);
    const err = new Error("Payment verification failed. Signature mismatch.");
    err.statusCode = 400;
    throw err;
  }

  // 4. Signature checks out — finish the registration via the shared logic.
  const result = await completeRegistrationForPayment(payment, {
    razorpayPaymentId,
    razorpaySignature,
  });

  return {
    schoolId: result.school.id,
    adminEmail: result.admin.email,
    loginUrl: LOGIN_URL,
    alreadyProcessed: false,
  };
}

/**
 * WHAT: Verifies a Razorpay WEBHOOK signature — completely different check
 *       from the checkout signature above.
 * WHY: Razorpay signs the entire raw webhook request body with a SEPARATE
 *      secret (RAZORPAY_WEBHOOK_SECRET, configured in the Razorpay
 *      dashboard's webhook settings — not the same as RAZORPAY_KEY_SECRET).
 *      This is the only proof a webhook call really came from Razorpay and
 *      wasn't forged by someone POSTing to our public webhook URL.
 *
 *      Must be computed over the EXACT raw bytes Razorpay sent — which is
 *      why the webhook route uses express.raw() instead of express.json()
 *      (see app.js): re-serializing a parsed-then-stringified JSON object
 *      is not guaranteed to produce byte-identical output (key order,
 *      whitespace), which would make the signature never match.
 *
 * @param {Buffer} rawBody         - the exact bytes of the request body
 * @param {string} signatureHeader - the "x-razorpay-signature" header value
 * RETURNS: boolean — true if the webhook call is genuinely from Razorpay.
 */
function isValidWebhookSignature(rawBody, signatureHeader) {
  if (!signatureHeader) return false;

  // crypto.createHmac("sha256", secret) — see isValidRazorpaySignature's
  // comment above for what an HMAC is; here it's computed over the raw
  // request body bytes instead of an "orderId|paymentId" string.
  const expectedSignature = crypto
    .createHmac("sha256", RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  const actualBuffer = Buffer.from(signatureHeader, "hex");

  // Same constant-time comparison reasoning as isValidRazorpaySignature —
  // guard the length check first since timingSafeEqual throws on mismatched
  // buffer lengths instead of just returning false.
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

/**
 * WHAT: Handles a "payment.captured" webhook event — Razorpay's own
 *       server-to-server confirmation that a payment succeeded.
 * WHY: This is Phase 5's safety net. Normally the frontend calls
 *      verifyPayment() right after checkout — but if the user's tab
 *      closed, their network died, etc. right after paying, that call
 *      might never happen. Razorpay still fires this webhook independently
 *      of the frontend, so the registration can complete even without it.
 *
 *      By the time this function is called, the CALLER (the webhook route
 *      handler) has already verified the webhook's raw-body signature —
 *      this function trusts that has happened and focuses only on "finish
 *      the registration for this order, exactly once."
 *
 * @param {object} params
 * @param {string} params.razorpayOrderId
 * @param {string} params.razorpayPaymentId
 * RETURNS: Promise<{ alreadyProcessed: boolean, schoolId?: number }>
 */
async function handleWebhookPaymentCaptured({ razorpayOrderId, razorpayPaymentId }) {
  const payment = await registrationRepository.findPaymentByOrderId(razorpayOrderId);

  if (!payment) {
    // An event about an order we have no record of — nothing we can do
    // with it. Let the caller decide how to respond to Razorpay (see
    // webhookHandler in registration.controller.js).
    const err = new Error(`Webhook: no Payment found for order ${razorpayOrderId}`);
    err.statusCode = 404;
    throw err;
  }

  // Idempotency: if verify-payment (or an earlier retry of this same
  // webhook event) already completed this registration, do nothing.
  // Exactly one School + one admin gets created, no matter which of the
  // two paths (checkout callback vs. webhook) got there first.
  if (payment.status === "paid") {
    return { alreadyProcessed: true };
  }

  // PHASE 8C — a Payment can now be for a subscription RENEWAL, not just a
  // new registration. purpose defaults to "registration" for every payment
  // row created before this column existed, so old behavior is untouched.
  // required() here (not a top-of-file require) deliberately, so that this
  // module and subscription.service.js can each require the other's
  // exports (isValidRazorpaySignature/rupeesToPaise this way, this webhook
  // branch the other way) without a circular-require load-order problem —
  // by the time this function actually RUNS, both modules have already
  // finished loading.
  if (payment.purpose === "renewal") {
    const subscriptionService = require("../subscription/subscription.service");
    // Merge in the webhook's razorpayPaymentId — the `payment` row fetched
    // above still has whatever it was created with (null, until someone
    // completes it), so without this override a renewal completed purely
    // via webhook (browser never called renew-verify) would record a null
    // razorpayPaymentId instead of the real one Razorpay just reported.
    const result = await subscriptionService.completeRenewalForPayment({ ...payment, razorpayPaymentId });
    return { alreadyProcessed: result.alreadyProcessed, schoolId: result.schoolId };
  }

  // Not yet paid — this webhook is the one completing the registration.
  // razorpaySignature is null here: webhooks don't carry the checkout's
  // per-payment signature field, and this payment's authenticity was
  // already established by the webhook's own raw-body signature check.
  const result = await completeRegistrationForPayment(payment, {
    razorpayPaymentId,
    razorpaySignature: null,
  });

  return { alreadyProcessed: false, schoolId: result.school.id };
}

module.exports = {
  listPlans,
  submitSchoolDetails,
  submitAdminDetails,
  getRegistrationSummary,
  applyCoupon,
  createOrder,
  verifyPayment,
  isValidWebhookSignature,
  handleWebhookPaymentCaptured,
  // PHASE 8C — exported (unchanged) so subscription.service.js can reuse the
  // exact same signature-verify + rupee→paise + date-math logic instead of
  // duplicating it.
  isValidRazorpaySignature,
  rupeesToPaise,
  addMonths,
};
