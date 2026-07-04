/**
 * RATE LIMITER MIDDLEWARE
 * ========================
 * Rate limiting means: "Only allow X requests from the same IP in Y minutes."
 * If someone exceeds the limit, we block them with a 429 (Too Many Requests) error.
 *
 * WHY DO WE NEED THIS?
 * Without rate limiting, a hacker can:
 *   1. Try thousands of passwords on /auth/login (brute force attack)
 *   2. Hammer /auth/refresh to overload your server (DoS attack)
 *
 * HOW express-rate-limit WORKS:
 * It tracks how many requests each IP address has made in a time window.
 * When an IP exceeds the limit, it blocks further requests until the window resets.
 *
 * Example:
 *   IP 192.168.1.1 hits /auth/login → count: 1
 *   IP 192.168.1.1 hits /auth/login → count: 2
 *   ... (5 times)
 *   IP 192.168.1.1 hits /auth/login → count: 6 → BLOCKED for 15 minutes
 *
 * HOW TO USE:
 * Import and apply to specific routes in auth.routes.js:
 *   router.post("/login", loginRateLimiter, loginHandler);
 *   router.post("/refresh", refreshRateLimiter, refreshHandler);
 */

const rateLimit = require("express-rate-limit");

/**
 * LOGIN RATE LIMITER
 *
 * Allows max 5 login attempts per IP per 15 minutes.
 * After 5 failed attempts, the IP is blocked for 15 minutes.
 *
 * This prevents brute force attacks where someone tries
 * "password1", "password2", "password3"... thousands of times.
 */
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes (in milliseconds)
  max: 5,                    // max 5 requests per windowMs per IP

  // This message is sent when the limit is exceeded
  message: {
    success: false,
    message: "Too many login attempts. Please try again after 15 minutes.",
  },

  // standardHeaders: true → sends rate limit info in response headers
  // The frontend can read these headers to show "you have X attempts left"
  // Headers added: RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset
  standardHeaders: true,

  // legacyHeaders: false → disables old X-RateLimit-* headers (they're outdated)
  legacyHeaders: false,
});

/**
 * REFRESH TOKEN RATE LIMITER
 *
 * Allows max 20 refresh requests per IP per 15 minutes.
 * More generous than login (20 vs 5) because:
 *   - Legitimate users refresh tokens frequently (every 15 minutes per session)
 *   - Multiple browser tabs = multiple refresh calls
 *
 * Still prevents abuse (e.g. a script hammering /refresh endlessly).
 */
const refreshRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,                   // max 20 refresh requests per 15 minutes per IP

  message: {
    success: false,
    message: "Too many token refresh attempts. Please try again later.",
  },

  standardHeaders: true,
  legacyHeaders: false,
});


const otpRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes (in milliseconds)
  max: 5,                    // max 5 requests per windowMs per IP

  // This message is sent when the limit is exceeded
  message: {
    success: false,
    message: "Too many login attempts. Please try again after 15 minutes.",
  },

  // standardHeaders: true → sends rate limit info in response headers
  // The frontend can read these headers to show "you have X attempts left"
  // Headers added: RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset
  standardHeaders: true,

  // legacyHeaders: false → disables old X-RateLimit-* headers (they're outdated)
  legacyHeaders: false,
});


// ─────────────────────────────────────────────
// SCHOOL REGISTRATION + PAYMENT — PHASE 7
// Three tiers, scoped ONLY to the public registration router
// (see registration.routes.js) — nothing global changes here.
// ─────────────────────────────────────────────

/**
 * REGISTRATION READ RATE LIMITER
 *
 * Allows 30 requests per IP per minute.
 * Applied to: GET /api/registration/plans
 *
 * This is a read-only, public pricing page — loosest limit of the three.
 * It still exists to stop a scraping script from hammering it, but a real
 * visitor reloading the pricing page a few times should never notice it.
 */
const registrationReadRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,

  message: {
    success: false,
    message: "Too many requests. Please slow down and try again shortly.",
  },

  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * REGISTRATION FORM RATE LIMITER
 *
 * Allows 20 requests per IP per 15 minutes.
 * Applied to: POST /school-details, POST /admin-details, GET /review/:tempId
 *
 * A real user filling out a 2-step signup form might hit "back" and retry a
 * validation error a few times, or refresh the review screen while deciding
 * — 20 per 15 minutes comfortably covers that, while still blocking a
 * script from mass-creating PendingRegistration rows.
 */
const registrationFormRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes

  max: 20,

  message: {
    success: false,
    message: "Too many registration attempts. Please try again in a few minutes.",
  },

  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * REGISTRATION PAYMENT RATE LIMITER
 *
 * Allows only 5 requests per IP per minute — the tightest limit here.
 * Applied to: POST /create-order, POST /verify-payment
 *
 * These two touch Razorpay's API and, on verify-payment, create a real
 * School + admin User — they're the highest-value targets for abuse
 * (hammering Razorpay's test/live API, or brute-forcing signature guesses
 * against verify-payment). A genuine checkout only ever calls each of
 * these once or twice per attempt, so 5/minute is generous for a real user
 * but tight enough to blunt any automated abuse.
 */
const registrationPaymentRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute

  max: 5,

  message: {
    success: false,
    message: "Too many payment requests. Please wait a moment and try again.",
  },

  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  loginRateLimiter,
  refreshRateLimiter,
  otpRateLimiter,
  registrationReadRateLimiter,
  registrationFormRateLimiter,
  registrationPaymentRateLimiter,
};
