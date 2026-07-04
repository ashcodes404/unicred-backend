/**
 * REGISTRATION CONTROLLER — PHASE 1 (Plans + Temporary Registration Storage)
 * ============================================================================
 * Thin HTTP layer for the "School Registration + Payment" flow.
 * Each handler: reads req.body/req.params, validates the shape of the input,
 * calls registration.service.js to do the real work, and shapes the response
 * with the shared success()/error() helpers (utils/apiResponse.js) so every
 * endpoint in the app returns the same { success, message, data } shape.
 *
 * All 4 routes here are PUBLIC — no logged-in user exists yet at this point
 * in the flow, so there is no req.user to read from.
 */

const registrationService = require("./registration.service");
const { success, error } = require("../../utils/apiResponse");

// Simple email format check, e.g. "admin@school.edu" — good enough to catch
// typos without being an overly strict RFC-5322 validator.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Simple domain format check, e.g. "school.edu" or "my-school.co.in" —
// letters/numbers/hyphens separated by dots, no "@" or protocol.
const DOMAIN_REGEX = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;

/**
 * WHAT: GET /api/registration/plans
 * WHY: Lets the frontend render the pricing/plan-selection screen before
 *      the user has typed anything — no auth, no tempId needed yet.
 * RETURNS: 200 + array of active SubscriptionPlans.
 */
async function getPlansHandler(req, res, next) {
  try {
    const plans = await registrationService.listPlans();
    return success(res, 200, "Plans fetched successfully", { plans });
  } catch (err) {
    next(err);
  }
}

/**
 * WHAT: POST /api/registration/school-details
 * WHY: Step 1 of signup — validates the school's info + chosen plan, then
 *      creates a PendingRegistration row and hands back a tempId the
 *      frontend will carry through the remaining steps.
 * RETURNS: 201 + { tempId, expiresAt }.
 */
async function submitSchoolDetailsHandler(req, res, next) {
  try {
    const {
      name,
      email,
      phone,
      domain,
      code,
      address,
      city,
      state,
      country,
      pincode,
      selectedPlan,
    } = req.body;

    // ── Required-field validation ──
    const requiredFields = { name, email, phone, domain, code, address, city, state, country, pincode, selectedPlan };
    const missingFields = Object.entries(requiredFields)
      .filter(([, value]) => value === undefined || value === null || value === "")
      .map(([key]) => key);

    if (missingFields.length > 0) {
      return error(res, 400, `Missing required field(s): ${missingFields.join(", ")}`);
    }

    // ── Format validation ──
    if (!EMAIL_REGEX.test(email)) {
      return error(res, 400, "Invalid email format");
    }

    if (!DOMAIN_REGEX.test(domain)) {
      return error(res, 400, "Invalid domain format (expected something like school.edu)");
    }

    const schoolFields = { name, email, phone, domain, code, address, city, state, country, pincode };

    const result = await registrationService.submitSchoolDetails(schoolFields, selectedPlan);

    return success(res, 201, "School details saved. Continue to admin details.", result);
  } catch (err) {
    next(err);
  }
}

/**
 * WHAT: POST /api/registration/admin-details
 * WHY: Step 2 of signup — validates the admin's info, hashes their password,
 *      and attaches it to the PendingRegistration identified by tempId.
 * RETURNS: 200 + { tempId, status }.
 */
async function submitAdminDetailsHandler(req, res, next) {
  try {
    const { tempId, name, email, phone, password } = req.body;

    // ── Required-field validation ──
    const requiredFields = { tempId, name, email, phone, password };
    const missingFields = Object.entries(requiredFields)
      .filter(([, value]) => value === undefined || value === null || value === "")
      .map(([key]) => key);

    if (missingFields.length > 0) {
      return error(res, 400, `Missing required field(s): ${missingFields.join(", ")}`);
    }

    // ── Format validation ──
    if (!EMAIL_REGEX.test(email)) {
      return error(res, 400, "Invalid email format");
    }

    // Basic strength check — a real policy (uppercase/number/symbol) can be
    // added later; for Phase 1 we just guard against trivially short passwords.
    if (password.length < 8) {
      return error(res, 400, "Password must be at least 8 characters long");
    }

    const result = await registrationService.submitAdminDetails(tempId, { name, email, phone, password });

    return success(res, 200, "Admin details saved successfully", result);
  } catch (err) {
    next(err);
  }
}

/**
 * WHAT: GET /api/registration/review/:tempId
 * WHY: Last screen before payment (a later phase) — shows the user
 *      everything they've entered so far in one combined summary.
 * RETURNS: 200 + combined school/admin/plan summary.
 */
async function getReviewHandler(req, res, next) {
  try {
    const { tempId } = req.params;

    if (!tempId) {
      return error(res, 400, "tempId is required");
    }

    const summary = await registrationService.getRegistrationSummary(tempId);

    return success(res, 200, "Registration summary fetched successfully", summary);
  } catch (err) {
    next(err);
  }
}

/**
 * WHAT: POST /api/registration/create-order
 * WHY: Once school + admin details are both submitted (status "ready"),
 *      this creates a Razorpay TEST MODE order and returns what the
 *      frontend's Razorpay checkout widget needs to open the payment popup.
 * RETURNS: 201 + { razorpayOrderId, amount (paise), currency, keyId }.
 *          NOTE: `keyId` is the PUBLIC key id — safe to expose. The secret
 *          key never leaves the server (see src/config/razorpay.js).
 */
async function createOrderHandler(req, res, next) {
  try {
    const { tempId } = req.body;

    if (!tempId) {
      return error(res, 400, "tempId is required");
    }

    const order = await registrationService.createOrder(tempId);

    return success(res, 201, "Payment order created successfully", order);
  } catch (err) {
    next(err);
  }
}

/**
 * WHAT: POST /api/registration/verify-payment
 * WHY: Called by the frontend right after Razorpay's checkout widget
 *      reports a successful payment. This is the ONLY place that verifies
 *      the payment is real (via signature check) and — only if genuine —
 *      creates the actual School + admin User.
 * RETURNS: 200 + { schoolId, adminEmail, loginUrl }.
 *          NEVER returns the Razorpay secret key or any password/hash.
 */
async function verifyPaymentHandler(req, res, next) {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    // ── Required-field validation ──
    const requiredFields = { razorpay_order_id, razorpay_payment_id, razorpay_signature };
    const missingFields = Object.entries(requiredFields)
      .filter(([, value]) => value === undefined || value === null || value === "")
      .map(([key]) => key);

    if (missingFields.length > 0) {
      return error(res, 400, `Missing required field(s): ${missingFields.join(", ")}`);
    }

    const result = await registrationService.verifyPayment({
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
    });

    // Exact success message per spec — this is what the frontend shows the
    // admin right before redirecting them to login (result.loginUrl).
    return success(
      res,
      200,
      "Registration completed successfully. Your school has been activated. You can now log in.",
      result,
    );
  } catch (err) {
    next(err);
  }
}

/**
 * WHAT: POST /api/registration/webhook — Razorpay's server-to-server
 *       payment confirmation (Phase 5's safety net).
 * WHY: Called directly by Razorpay's servers (never the browser) right
 *      after a payment succeeds, independent of whether the frontend ever
 *      got to call verify-payment. If the user's tab closed or their
 *      network died right after paying, this is what still completes the
 *      registration.
 *
 * IMPORTANT: this route is wired up in src/app.js with express.raw()
 * BEFORE the app's global express.json() — NOT here in registration.routes.js.
 * That's because the global JSON parser (mounted before /api routes) would
 * otherwise consume the request body before it ever reaches this router,
 * leaving nothing for a route-local express.raw() to read. req.body here
 * is therefore a raw Buffer, not a parsed object — see app.js for the full
 * explanation.
 *
 * RETURNS: Always some 2xx/4xx/5xx JSON body (Razorpay doesn't care about
 *          the content, only the status code — 2xx means "delivered,
 *          don't retry"; a non-2xx means "please retry this event later").
 */
async function webhookHandler(req, res) {
  try {
    const signature = req.headers["x-razorpay-signature"];
    const rawBody = req.body; // Buffer — see the note above on why

    // Signature check FIRST, before we even look at the payload's contents.
    // A mismatch means this request did NOT genuinely come from Razorpay —
    // create/change nothing, just reject it.
    if (!registrationService.isValidWebhookSignature(rawBody, signature)) {
      return error(res, 400, "Invalid webhook signature");
    }

    // Only safe to parse the JSON now that we've confirmed the bytes are
    // genuinely from Razorpay. JSON.parse() turns the raw text into a
    // normal JS object we can read fields off of.
    const event = JSON.parse(rawBody.toString("utf8"));

    // We only act on successful payment captures — every other event type
    // (refunds, disputes, etc.) is ignored. Still respond 200 so Razorpay
    // marks the event delivered and stops retrying it.
    if (event.event !== "payment.captured") {
      return success(res, 200, `Ignored event type: ${event.event}`);
    }

    const paymentEntity = event.payload?.payment?.entity;
    const razorpayOrderId = paymentEntity?.order_id;
    const razorpayPaymentId = paymentEntity?.id;

    if (!razorpayOrderId || !razorpayPaymentId) {
      // Payload didn't have the shape we expect — nothing safe to act on.
      return success(res, 200, "Ignored: payload missing order/payment id");
    }

    const result = await registrationService.handleWebhookPaymentCaptured({
      razorpayOrderId,
      razorpayPaymentId,
    });

    return success(
      res,
      200,
      result.alreadyProcessed ? "Already processed" : "Registration completed via webhook",
      result,
    );
  } catch (err) {
    // Errors with a 4xx statusCode (payment not found, registration
    // expired, plan unavailable, domain/email collision) are PERMANENT —
    // Razorpay retrying the same event later won't change the outcome. We
    // acknowledge with 200 so it stops retrying, but log the problem so a
    // human can investigate if needed.
    if (err.statusCode && err.statusCode < 500) {
      console.error("[webhook] business error (permanent, not retried):", err.message);
      return success(res, 200, `Acknowledged (unprocessable): ${err.message}`);
    }

    // Anything else is unexpected/transient (e.g. a momentary DB problem) —
    // respond with a real error status so Razorpay retries this event later.
    console.error("[webhook] unexpected error, Razorpay will retry:", err);
    return error(res, 500, "Internal error processing webhook");
  }
}

module.exports = {
  getPlansHandler,
  submitSchoolDetailsHandler,
  submitAdminDetailsHandler,
  getReviewHandler,
  createOrderHandler,
  verifyPaymentHandler,
  webhookHandler,
};
