// =============================================================================
// SCHOOL REGISTRATION ROUTES — PHASE 1 + PHASE 2 + PHASE 3 + PHASE 5
// =============================================================================
//
// Mounted at /api/registration in routes/index.js.
// Every route here is PUBLIC (no authenticate/requireRole) — the person
// filling this form does not have an account yet.
//
//   GET  /api/registration/plans              — list active subscription plans
//   GET  /api/registration/coupons             — list currently-usable coupons (landing page, Phase 8F)
//   POST /api/registration/school-details      — step 1: save school info, get tempId
//   POST /api/registration/admin-details        — step 2: save admin info against tempId
//   GET  /api/registration/review/:tempId      — step 3: combined summary before payment
//   POST /api/registration/apply-coupon         — optional: validate + preview a coupon (Phase 8B)
//   POST /api/registration/create-order         — step 4: create a Razorpay TEST MODE order
//   POST /api/registration/verify-payment       — step 5: verify signature, create School + admin User
//
// verify-payment and the webhook (below) are the ONLY places in the whole
// app that create a School or an admin User — see registration.service.js's
// completeRegistrationForPayment() / registration.repository.js.
//
// NOTE: POST /api/registration/webhook is NOT registered in this file, even
// though it's logically part of this module. Razorpay's webhook needs the
// exact raw request body (a Buffer) to verify its signature, but this
// router is mounted under /api — AFTER the app's global express.json() has
// already parsed (and consumed) every request body. So the webhook route
// is instead registered directly in src/app.js, before express.json() runs.
// Its handler (webhookHandler) still lives in registration.controller.js,
// right alongside every other handler here.
// =============================================================================

const express = require("express");
const router = express.Router();

const {
  getPlansHandler,
  getActiveCouponsHandler,
  submitSchoolDetailsHandler,
  submitAdminDetailsHandler,
  getReviewHandler,
  applyCouponHandler,
  createOrderHandler,
  verifyPaymentHandler,
} = require("./registration.controller");

// PHASE 7 — rate limiting scoped to this router only (see rateLimit.middleware.js
// for the reasoning behind each tier's numbers). Nothing global is affected.
const {
  registrationReadRateLimiter,
  registrationFormRateLimiter,
  registrationPaymentRateLimiter,
} = require("../../middleware/rateLimit.middleware");

router.get("/plans", registrationReadRateLimiter, getPlansHandler);
router.get("/coupons", registrationReadRateLimiter, getActiveCouponsHandler);
router.post("/school-details", registrationFormRateLimiter, submitSchoolDetailsHandler);
router.post("/admin-details", registrationFormRateLimiter, submitAdminDetailsHandler);
router.get("/review/:tempId", registrationFormRateLimiter, getReviewHandler);
// PHASE 8B — the tight payment-tier limiter (5/min) is used here, not the
// looser form tier, because this endpoint lets someone guess coupon codes
// one at a time — the same "money-sensitive, must be hard to brute-force"
// reasoning as create-order/verify-payment below.
router.post("/apply-coupon", registrationPaymentRateLimiter, applyCouponHandler);
router.post("/create-order", registrationPaymentRateLimiter, createOrderHandler);
router.post("/verify-payment", registrationPaymentRateLimiter, verifyPaymentHandler);

module.exports = router;
