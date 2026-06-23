/**
 * AUTH CONTROLLER — PHASE 2 (patched)
 * =====================================
 * Changes from previous version:
 *
 * 1. registerHandler — no longer reads role or schoolId from req.body.
 *    Only accepts: email, password, name.
 *    School is resolved inside authService.register() via email domain.
 *    Role is hardcoded to "student" in the service.
 *
 * 2. inviteHandler — new handler for POST /auth/invite (admin-only route).
 *    Accepts: email, name, role (faculty | hod | admin).
 *    schoolId is taken from req.user (the admin's verified JWT) — never from body.
 *    Returns the new user record + tempPassword (for testing; remove once email is wired).
 *
 * Everything else (loginHandler, refreshHandler, logoutHandler, logoutAllHandler)
 * is unchanged from the previous version.
 */

const authService = require("./auth.service");
const { success, error } = require("../../utils/apiResponse");
const { REFRESH_TOKEN_EXPIRES_DAYS } = require("../../config/env");

/**
 * Extracts device info from the request for audit logging.
 */
function extractDeviceInfo(req) {
  return {
    ipAddress: req.ip || null,
    deviceName: req.headers["user-agent"] || null,
  };
}

/**
 * Sets the refresh token as a secure httpOnly cookie.
 *   httpOnly  → JS on the page cannot read it (XSS protection)
 *   secure    → HTTPS only in production
 *   sameSite  → not sent on cross-site requests (CSRF protection)
 */
function setRefreshTokenCookie(res, token) {
  const maxAgeMs = (REFRESH_TOKEN_EXPIRES_DAYS || 7) * 24 * 60 * 60 * 1000;

  res.cookie("refreshToken", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: maxAgeMs,
  });
}

// ─────────────────────────────────────────────
// POST /api/auth/register
//
// Open endpoint — no auth required.
// Creates a student account. School is inferred from email domain.
// role and schoolId are NOT accepted from the client.
// ─────────────────────────────────────────────
async function registerHandler(req, res, next) {
  try {
    const { email, password, name } = req.body;

    // Only these three fields — role and schoolId are intentionally excluded
    if (!email || !password || !name) {
      return error(res, 400, "email, password, and name are required");
    }

    const user = await authService.register({ email, password, name });

    return success(res, 201, "Student account created successfully", { user });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────
// POST /api/auth/invite
//
// Admin-only — requires valid access token + role "admin".
// Wired in auth.routes.js behind: authMiddleware, requireRole("admin")
//
// Body: { email, name, role }   (role must be: faculty | hod | admin)
// schoolId is NOT read from the body — it comes from req.user (admin's JWT).
//
// Returns the new user + a temporary password.
// TODO: once email is wired up, send tempPassword by email and remove it from the response.
// ─────────────────────────────────────────────
async function inviteHandler(req, res, next) {
  try {
    const { email, name, role } = req.body;

    if (!email || !name || !role) {
      return error(res, 400, "email, name, and role are required");
    }

    // req.user is set by auth.middleware.js — contains userId, role, schoolId from JWT.
    // schoolId here is the admin's school; the service enforces the invite happens within it.
    const adminUser = req.user;

    const result = await authService.invite({ email, name, role }, adminUser);

    return success(res, 201, "User invited successfully", { user: result });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────
// POST /api/auth/login
// ─────────────────────────────────────────────
async function loginHandler(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return error(res, 400, "email and password are required");
    }

    const deviceInfo = extractDeviceInfo(req);

    const { accessToken, refreshToken, user } = await authService.login(
      { email, password },
      deviceInfo,
    );

    setRefreshTokenCookie(res, refreshToken);

    return success(res, 200, "Login successful", { accessToken, user });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────
// POST /api/auth/refresh
// ─────────────────────────────────────────────
async function refreshHandler(req, res, next) {
  try {
    const rawRefreshToken = req.cookies?.refreshToken;
    const deviceInfo = extractDeviceInfo(req);

    const { accessToken, refreshToken: newRefreshToken } =
      await authService.refresh(rawRefreshToken, deviceInfo);

    setRefreshTokenCookie(res, newRefreshToken);

    return success(res, 200, "Token refreshed", { accessToken });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────
// POST /api/auth/logout
// ─────────────────────────────────────────────
async function logoutHandler(req, res, next) {
  try {
    const rawRefreshToken = req.cookies?.refreshToken;
    const deviceInfo = extractDeviceInfo(req);

    await authService.logout(rawRefreshToken, deviceInfo);

    res.clearCookie("refreshToken");

    return success(res, 200, "Logged out successfully");
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────
// POST /api/auth/logout-all
// Requires valid access token (auth.middleware.js runs first).
// ─────────────────────────────────────────────
async function logoutAllHandler(req, res, next) {
  try {
    const userId = req.user.userId;
    const deviceInfo = extractDeviceInfo(req);

    await authService.logoutAll(userId, deviceInfo);

    res.clearCookie("refreshToken");

    return success(res, 200, "Logged out from all devices successfully");
  } catch (err) {
    next(err);
  }
}

/**
 * --------------------------------------------------------
 * VERIFY OTP CONTROLLER
 * --------------------------------------------------------
 *
 * Route:
 * POST /auth/verify-otp
 *
 * Request Body:
 * {
 *   "email": "student@school.edu",
 *   "otp": "123456"
 * }
 */
async function verifyOtp(req, res, next) {
  try {
    const result = await authService.verifyOtp(req.body);

    return success(res, 200, "Email verified successfully", result);
  } catch (err) {
    next(err);
  }
}

/**
 * --------------------------------------------------------
 * RESEND OTP CONTROLLER
 * --------------------------------------------------------
 *
 * Route:
 * POST /auth/resend-otp
 *
 * Request Body:
 * {
 *   "email": "student@school.edu"
 * }
 */
async function resendOtp(req, res, next) {
  try {
    const result = await authService.resendOtp(req.body);

    return success(res, 200, "OTP sent successfully", result);
  } catch (err) {
    next(err);
  }
}

async function forgotPassword(req, res, next) {
  try {
    const result = await authService.forgotPassword(req.body);

    return success(res, 200, result.message);
  } catch (err) {
    next(err);
  }
}

async function resetPassword(req, res, next) {
  try {
    const result = await authService.resetPassword(req.body);

    return success(res, 200, result.message);
  } catch (err) {
    next(err);
  }
}

/**
 * ============================================================
 * VERIFY RESET OTP CONTROLLER
 * ============================================================
 *
 * Route:
 * POST /auth/verify-reset-otp
 *
 * Body:
 * {
 *   "email": "student@school.com",
 *   "otp": "123456"
 * }
 *
 * Purpose:
 * Verify password reset OTP before
 * allowing user to set a new password.
 */
async function verifyResetOtp(req, res, next) {
  try {
    const result =
      await authService.verifyResetOtp(
        req.body
      );

    return success(
      res,
      200,
      result.message,
      result
    );

  } catch (err) {
    next(err);
  }
}
module.exports = {
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
};
