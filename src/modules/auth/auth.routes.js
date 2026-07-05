/**
 * AUTH ROUTES — PHASE 2 (patched)
 * =================================
 * Both auth.middleware.js and role.middleware.js use default exports,
 * so they're imported directly (not destructured).
 *
 * PUBLIC:
 *   POST /register   → student self-registration (school resolved from email domain)
 *   POST /login      → returns access token + sets refresh cookie
 *   POST /refresh    → rotates refresh token, returns new access token
 *   POST /logout     → revokes current device's refresh token
 *
 * ADMIN or HOD:
 *   POST /invite     → admin creates faculty/hod/admin; hod creates faculty
 *                      only (see ALLOWED_INVITEE_ROLES_BY_INVITER_ROLE in
 *                      auth.service.js's invite())
 *
 * AUTHENTICATED (any role):
 *   POST /logout-all → revokes all refresh tokens for this user
 */

const express = require("express");
const router = express.Router();

const {
  registerHandler,
  inviteHandler,
  loginHandler,
  refreshHandler,
  logoutHandler,
  logoutAllHandler,
  verifyOtp,
  resendOtp,
  forgotPassword,
  resetPassword,
  verifyResetOtp,
} = require("./auth.controller");

const {
  loginRateLimiter,
  refreshRateLimiter,
  otpRateLimiter,
  registerRateLimiter,
} = require("../../middleware/rateLimit.middleware");

// Default exports — no destructuring
const authenticate = require("../../middleware/auth.middleware");
const requireRole = require("../../middleware/role.middleware");

// ── PUBLIC ROUTES ─────────────────────────────────────────────────────────────

// registerRateLimiter/otpRateLimiter added here — /register, /verify-otp,
// and /resend-otp all trigger an email send with no prior limiter, an open
// email-bombing vector (same abuse category otpRateLimiter already blocks
// on the password-reset routes below).
router.post("/register", registerRateLimiter, registerHandler);
router.post("/login", loginRateLimiter, loginHandler);
router.post("/refresh", refreshRateLimiter, refreshHandler);
router.post("/logout", logoutHandler);
router.post("/verify-otp", otpRateLimiter, verifyOtp);
router.post("/resend-otp", otpRateLimiter, resendOtp);

/**
 * ----------------------------------------------------
 * PASSWORD RESET ROUTES
 * ----------------------------------------------------
 *
 * Public Routes
 *
 * User may not be logged in when
 * resetting password.
 */

router.post("/forgot-password", otpRateLimiter, forgotPassword);

router.post("/reset-password", otpRateLimiter, resetPassword);

/**
 * ----------------------------------------------------
 * VERIFY PASSWORD RESET OTP
 * ----------------------------------------------------
 *
 * Used before showing
 * new password form.
 */

router.post("/verify-reset-otp", otpRateLimiter, verifyResetOtp);

// ── ADMIN or HOD ──────────────────────────────────────────────────────────────

// schoolId comes from the caller's JWT (req.user.schoolId) — never from body.
// Body: { email, name, role }. Which `role` values are actually allowed
// depends on the CALLER's own role — enforced in auth.service.js's invite(),
// not here (an admin may invite faculty/hod/admin; an hod may only invite
// faculty).
router.post("/invite", authenticate, requireRole("admin" , "hod"), inviteHandler);

// ── AUTHENTICATED (any role) ──────────────────────────────────────────────────

router.post("/logout-all", authenticate, logoutAllHandler);

module.exports = router;
