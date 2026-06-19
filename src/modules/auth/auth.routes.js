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
 * ADMIN-ONLY:
 *   POST /invite     → admin creates a faculty/hod/admin account
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
} = require("./auth.controller");

const { loginRateLimiter, refreshRateLimiter } = require("../../middleware/rateLimit.middleware");

// Default exports — no destructuring
const authenticate = require("../../middleware/auth.middleware");
const requireRole  = require("../../middleware/role.middleware");

// ── PUBLIC ROUTES ─────────────────────────────────────────────────────────────

router.post("/register", registerHandler);
router.post("/login",    loginRateLimiter,   loginHandler);
router.post("/refresh",  refreshRateLimiter, refreshHandler);
router.post("/logout",   logoutHandler);

// ── ADMIN-ONLY ────────────────────────────────────────────────────────────────

// schoolId comes from admin's JWT (req.user.schoolId) — never from body
// Body: { email, name, role }  where role ∈ { "faculty", "hod", "admin" }
router.post("/invite", authenticate, requireRole("admin"), inviteHandler);

// ── AUTHENTICATED (any role) ──────────────────────────────────────────────────

router.post("/logout-all", authenticate, logoutAllHandler);

module.exports = router;