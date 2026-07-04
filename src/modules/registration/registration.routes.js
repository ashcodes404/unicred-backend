// =============================================================================
// SCHOOL REGISTRATION ROUTES — PHASE 1 + PHASE 2 + PHASE 3 + PHASE 5
// =============================================================================
//
// Mounted at /api/registration in routes/index.js.
// Every route here is PUBLIC (no authenticate/requireRole) — the person
// filling this form does not have an account yet.
//
//   GET  /api/registration/plans              — list active subscription plans
//   POST /api/registration/school-details      — step 1: save school info, get tempId
//   POST /api/registration/admin-details        — step 2: save admin info against tempId
//   GET  /api/registration/review/:tempId      — step 3: combined summary before payment
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
  submitSchoolDetailsHandler,
  submitAdminDetailsHandler,
  getReviewHandler,
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
router.post("/school-details", registrationFormRateLimiter, submitSchoolDetailsHandler);
router.post("/admin-details", registrationFormRateLimiter, submitAdminDetailsHandler);
router.get("/review/:tempId", registrationFormRateLimiter, getReviewHandler);
router.post("/create-order", registrationPaymentRateLimiter, createOrderHandler);
router.post("/verify-payment", registrationPaymentRateLimiter, verifyPaymentHandler);

module.exports = router;
