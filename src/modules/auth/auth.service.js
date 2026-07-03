/**
 * AUTH SERVICE — PHASE 2 (patched)
 * ==================================
 * Changes from the previous version:
 *
 * 1. REGISTRATION LOCKED DOWN
 *    register() no longer accepts role or schoolId from the caller.
 *    - role is hardcoded to "student" — only students self-register.
 *    - schoolId is derived from the email domain via School.emailDomain lookup.
 *      If the domain doesn't match any school in the DB, registration is rejected.
 *    This closes the privilege-escalation hole where anyone could POST
 *    { role: "admin", schoolId: 1 } and become a full admin of any school.
 *
 * 2. ADMIN INVITE FLOW
 *    New invite() function for admin to create faculty/hod/admin accounts.
 *    - Requires the calling admin's userId + schoolId (from their verified JWT).
 *    - Generates a temporary password and logs the event.
 *    - In production, the temp password would be emailed; here it's returned
 *      in the response so you can test without an email service wired up.
 *    - Route: POST /auth/invite (admin-only, behind requireRole("admin"))
 *
 * 3. REFRESH CHECKS DEACTIVATION BEFORE REUSE DETECTION
 *    Previously, deactivating a user + revoking their tokens caused the next
 *    refresh attempt to be logged as TOKEN_REUSE_DETECTED (a false positive
 *    security incident). Now refresh() checks isActive/deletedAt first and
 *    throws a clean "account inactive" error instead.
 *
 * Everything else (rotation, reuse detection, audit logging, logoutAll) is unchanged.
 */

const crypto = require("crypto");
const prisma = require("../../config/db");
const {
  hashPassword,
  comparePassword,
  generateRefreshToken,
  hashRefreshToken,
  hashOtp,
  compareOtp,
} = require("../../utils/hash");
const { signAccessToken } = require("../../utils/jwt");
const { writeAuditLog, AUDIT_EVENTS } = require("../../utils/audit");
const { REFRESH_TOKEN_EXPIRES_DAYS } = require("../../config/env");

const { enqueueEmail } = require("../../queues/email.queue");

/**
 * --------------------------------------------------------
 * generateOtp()
 * --------------------------------------------------------
 *
 * Purpose:
 * Generates a random 6-digit OTP.
 *
 * Example Outputs:
 * 483921
 * 125678
 * 987654
 *
 * Why 6 digits?
 * - Easy for users to type
 * - Common industry standard
 * - Enough combinations (900,000)
 *
 * Used In:
 * - Email Verification
 * - Password Reset
 * - Future Login Verification
 *
 * Returns:
 * String
 */
function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * --------------------------------------------------------
 * getOtpExpiry()
 * --------------------------------------------------------
 *
 * Purpose:
 * Calculates OTP expiration timestamp.
 *
 * Current Expiry:
 * 10 minutes
 *
 * Example:
 *
 * Current Time:
 * 10:00 AM
 *
 * Expiry Time:
 * 10:10 AM
 *
 * Why expire OTPs?
 * - Prevent OTP reuse
 * - Improve security
 * - Reduce attack window
 *
 * Returns:
 * Date Object
 */
function getOtpExpiry() {
  return new Date(Date.now() + 10 * 60 * 1000);
}

// ─────────────────────────────────────────────
// HELPER: expiry date for a new refresh token
// ─────────────────────────────────────────────
function getRefreshTokenExpiry() {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + (REFRESH_TOKEN_EXPIRES_DAYS || 7));
  return expiresAt;
}

// ─────────────────────────────────────────────
// HELPER: extract the domain part from an email address
// e.g. "alice@students.dps.edu" → "students.dps.edu"
// ─────────────────────────────────────────────
function extractEmailDomain(email) {
  const parts = email.split("@");
  if (parts.length !== 2 || !parts[1]) {
    const err = new Error("Invalid email format");
    err.statusCode = 400;
    throw err;
  }
  return parts[1].toLowerCase();
}

// ─────────────────────────────────────────────
// REGISTER — student self-registration only
//
// WHO CAN USE THIS: anyone (unauthenticated), but only becomes a student.
// SCHOOL RESOLUTION: derived from email domain → School.emailDomain in DB.
//   If no school matches the domain, registration is rejected with 403.
//   This ensures students can only join schools whose domain matches their email.
//
// WHAT CALLERS PROVIDE: { email, password, name }
// WHAT THIS IGNORES:    role (hardcoded "student"), schoolId (derived from email)
// ─────────────────────────────────────────────
async function register({ email, password, name }) {
  // 1. Derive school from email domain
  const domain = extractEmailDomain(email);

  const school = await prisma.school.findFirst({
    where: { domain }, // schema field is "domain", not "emailDomain"
  });

  if (!school) {
    // Don't reveal which domains are valid — generic message
    const err = new Error(
      "Registration is not available for your email domain. Contact your school admin.",
    );
    err.statusCode = 403;
    throw err;
  }

  // 2. Check if email is already taken
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    const err = new Error("Email already registered");
    err.statusCode = 409;
    throw err;
  }

  // 3. Hash the password
  const passwordHash = await hashPassword(password);

  // 4. Create the user — role is ALWAYS "student" here, schoolId from domain lookup
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name,
      role: "student", // ← hardcoded, never from client
      schoolId: school.id, // ← from DB lookup, never from client
      emailVerified: false,
    },
  });

  /**
   * --------------------------------------------------------
   * Generate Email Verification OTP
   * --------------------------------------------------------
   *
   * Every self-registered user must verify
   * ownership of their email address.
   *
   * Flow:
   *
   * User Registers
   *      ↓
   * OTP Generated
   *      ↓
   * OTP Saved To Database
   *      ↓
   * OTP Sent Via Email
   *      ↓
   * User Verifies Email
   */
  const otp = generateOtp();
  const hashedOtp = await hashOtp(otp);

  /**
   * Save OTP inside OtpVerification table.
   *
   * otpType:
   * EMAIL_VERIFICATION
   *
   * expiresAt:
   * Current Time + 10 Minutes
   */
  await prisma.otpVerification.create({
    data: {
      userId: user.id,
      email: user.email,
      otpCode: hashedOtp,
      otpType: "EMAIL_VERIFICATION",
      expiresAt: getOtpExpiry(),
    },
  });

  /**
   * Send OTP to user's email.
   *
   * Development:
   * Logs OTP in terminal.
   *
   * Production:
   * Sends actual email via Gmail.
   */
  await enqueueEmail("verification-otp", { email: user.email, otp });

  // 5. Audit log
  await writeAuditLog({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_EVENTS.REGISTER,
    metadata: { email, role: "student", resolvedSchoolId: school.id },
  });

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    schoolId: user.schoolId,
  };
}

/**

* ---
* VERIFY EMAIL OTP
* ---
*
* Purpose:
* Verify ownership of email address.
*
* Flow:
*
* User submits:
* email + otp
*
* ```
   ↓
  ```
*
* Find User
*
* ```
   ↓
  ```
*
* Find Latest OTP
*
* ```
   ↓
  ```
*
* Check:
* * Exists?
* * Expired?
* * Already Used?
*
* ```
   ↓
  ```
*
* Mark OTP Used
*
* ```
   ↓
  ```
*
* Update User
* emailVerified = true
*
* ```
   ↓
  ```
*
* Success
  */
async function verifyOtp({ email, otp }) {
  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    const err = new Error("User not found");
    err.statusCode = 404;
    throw err;
  }

  const otpRecord = await prisma.otpVerification.findFirst({
    where: {
      userId: user.id,
      email,
      otpType: "EMAIL_VERIFICATION",
      usedAt: null,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const otpMatches = await compareOtp(otp, otpRecord.otpCode);

  if (!otpMatches) {
    const err = new Error("Invalid OTP");
    err.statusCode = 400;
    throw err;
  }

  if (!otpRecord) {
    const err = new Error("Invalid OTP");
    err.statusCode = 400;
    throw err;
  }

  if (otpRecord.usedAt) {
    const err = new Error("OTP already used");
    err.statusCode = 400;
    throw err;
  }

  if (otpRecord.expiresAt < new Date()) {
    const err = new Error("OTP has expired");
    err.statusCode = 400;
    throw err;
  }

  await prisma.otpVerification.update({
    where: {
      id: otpRecord.id,
    },
    data: {
      usedAt: new Date(),
    },
  });

  await prisma.user.update({
    where: {
      id: user.id,
    },
    data: {
      emailVerified: true,
    },
  });

  return {
    success: true,
    message: "Email verified successfully",
  };
}

/**

* ---
* RESEND EMAIL VERIFICATION OTP
* ---
*
* Purpose:
* Generate and send a fresh OTP when:
* * User didn't receive email
* * Previous OTP expired
* * User requests a new OTP
*
* Flow:
*
* Email
* ↓
* Find User
* ↓
* Already Verified?
* ↓
* Delete Old Unused OTPs
* ↓
* Generate New OTP
* ↓
* Save New OTP
* ↓
* Send Email
  */
async function resendOtp({ email }) {
  /**

  * Find user by email.
    */
  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    const err = new Error("User not found");
    err.statusCode = 404;
    throw err;
  }

  /**

* Verified users do not need OTPs.
  */
  if (user.emailVerified) {
    const err = new Error("Email is already verified");

    err.statusCode = 400;
    throw err;
  }

  /**

* Remove all previous unused
* email verification OTPs.
*
* This prevents multiple active
* OTPs existing simultaneously.
  */
  await prisma.otpVerification.deleteMany({
    where: {
      userId: user.id,
      otpType: "EMAIL_VERIFICATION",
      usedAt: null,
    },
  });

  /**

* Generate fresh OTP.
  */
  const otp = generateOtp();
  const hashedOtp = await hashOtp(otp);

  /**

* Store OTP.
  */
  await prisma.otpVerification.create({
    data: {
      userId: user.id,
      email: user.email,
      otpCode: hashedOtp,
      otpType: "EMAIL_VERIFICATION",
      expiresAt: getOtpExpiry(),
    },
  });

  /**

* Send email.
  */
  await enqueueEmail("verification-otp", { email: user.email, otp });

  return {
    success: true,
    message: "OTP resent successfully",
  };
}

// ─────────────────────────────────────────────
// INVITE — admin creates faculty/hod/admin accounts
//
// WHO CAN USE THIS: admin only (enforced at route level via requireRole("admin"))
// HOW IT WORKS:
//   Admin supplies { email, name, role } for the new account.
//   schoolId is taken from the calling admin's JWT (req.user.schoolId) —
//   an admin can only create users in their own school.
//   A temporary password is generated server-side; in production this would
//   be emailed. For now it's returned in the response so you can test.
//
// ALLOWED ROLES: "faculty", "hod", "admin"
//   (students self-register via register() above — never via invite)
// ─────────────────────────────────────────────
async function invite({ email, name, role }, adminUser) {
  // 1. Validate role — admins cannot invite students (students self-register)
  const allowedRoles = ["faculty", "hod", "admin"];
  if (!allowedRoles.includes(role)) {
    const err = new Error(
      `Invalid role "${role}". Invite is only for: ${allowedRoles.join(", ")}`,
    );
    err.statusCode = 400;
    throw err;
  }

  // 2. School comes from the admin's JWT — admin cannot create users in other schools
  const schoolId = adminUser.schoolId;

  // 3. Confirm the school exists (sanity check — schoolId from JWT should always be valid)
  const school = await prisma.school.findUnique({ where: { id: schoolId } });
  if (!school) {
    const err = new Error("Admin's school not found");
    err.statusCode = 500;
    throw err;
  }

  // 4. Check if email is already taken
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    const err = new Error("Email already registered");
    err.statusCode = 409;
    throw err;
  }

  // 5. Generate a temporary password
  //    In production: email this to the invitee and don't return it in the response.
  //    For now: returned in the response body for testing.
  const tempPassword = crypto.randomBytes(12).toString("hex"); // 24-char hex string
  const passwordHash = await hashPassword(tempPassword);

  // 6. Create the user
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name,
      role, // faculty | hod | admin — validated above
      schoolId, // from admin's JWT, not from request body
      emailVerified: true,
    },
  });

  /**
   * --------------------------------------------------------
   * SEND ACCOUNT CREATED EMAIL
   * --------------------------------------------------------
   *
   * Faculty/HOD/Admin accounts are created
   * by an administrator.
   *
   * No OTP is required.
   *
   * The user receives:
   * - Email
   * - Temporary Password
   * - Role
   * - School Information
   */
  await enqueueEmail("account-created", {
    email,
    name,
    password: tempPassword,
    role,
    schoolName: school.name,
  });

  // 7. Audit log — record who invited whom
  await writeAuditLog({
    userId: adminUser.userId,
    schoolId,
    action: AUDIT_EVENTS.REGISTER,
    metadata: {
      invitedBy: adminUser.userId,
      newUserId: user.id,
      email,
      role,
      note: "Created via admin invite",
    },
  });

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    schoolId: user.schoolId,
    // TODO: remove tempPassword from response once email sending is wired up
    tempPassword,
  };
}

// ─────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────
async function login({ email, password }, deviceInfo = {}) {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    await writeAuditLog({
      action: AUDIT_EVENTS.LOGIN_FAILED,
      ipAddress: deviceInfo.ipAddress,
      userAgent: deviceInfo.deviceName,
      metadata: { reason: "email not found", attemptedEmail: email },
    });
    const err = new Error("Invalid email or password");
    err.statusCode = 401;
    throw err;
  }

  /**
   * --------------------------------------------------------
   * Email Verification Check
   * --------------------------------------------------------
   *
   * Security Rule:
   *
   * Unverified users are NOT allowed
   * to log in.
   *
   * Registration Flow:
   *
   * Register
   *    ↓
   * Verify Email
   *    ↓
   * Login
   *
   * Invited Faculty/HOD:
   * emailVerified=true at creation,
   * therefore this check passes.
   */

  if (!user.emailVerified) {
    const err = new Error("Please verify your email before logging in");

    err.statusCode = 401;

    throw err;
  }

  if (!user.isActive || user.deletedAt) {
    const err = new Error("This account is inactive");
    err.statusCode = 403;
    throw err;
  }

  const passwordMatches = await comparePassword(password, user.passwordHash);

  if (!passwordMatches) {
    await writeAuditLog({
      userId: user.id,
      schoolId: user.schoolId,
      action: AUDIT_EVENTS.LOGIN_FAILED,
      ipAddress: deviceInfo.ipAddress,
      userAgent: deviceInfo.deviceName,
      metadata: { reason: "wrong password" },
    });
    const err = new Error("Invalid email or password");
    err.statusCode = 401;
    throw err;
  }

  const accessToken = signAccessToken({
    userId: user.id,
    role: user.role,
    schoolId: user.schoolId,
  });

  const rawRefreshToken = generateRefreshToken();
  const tokenHash = hashRefreshToken(rawRefreshToken);
  const tokenFamily = crypto.randomUUID();

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash,
      family: tokenFamily,
      deviceName: deviceInfo.deviceName || null,
      ipAddress: deviceInfo.ipAddress || null,
      expiresAt: getRefreshTokenExpiry(),
    },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  await writeAuditLog({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_EVENTS.LOGIN_SUCCESS,
    ipAddress: deviceInfo.ipAddress,
    userAgent: deviceInfo.deviceName,
  });

  return {
    accessToken,
    refreshToken: rawRefreshToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      schoolId: user.schoolId,
    },
  };
}

// ─────────────────────────────────────────────
// REFRESH — rotation + reuse detection
//
// FIX vs previous version:
//   Now checks isActive/deletedAt BEFORE the revokedAt reuse-detection check.
//   Previously, deactivating a user (which revokes all their tokens) would cause
//   their next refresh attempt to log TOKEN_REUSE_DETECTED — a misleading false
//   positive in the security audit log.
//   Now it logs a clean "account inactive" 403 instead.
// ─────────────────────────────────────────────
async function refresh(rawRefreshToken, deviceInfo = {}) {
  if (!rawRefreshToken) {
    const err = new Error("No refresh token provided");
    err.statusCode = 401;
    throw err;
  }

  const tokenHash = hashRefreshToken(rawRefreshToken);

  const storedToken = await prisma.refreshToken.findFirst({
    where: { tokenHash },
    include: { user: true },
  });

  if (!storedToken) {
    const err = new Error("Invalid refresh token");
    err.statusCode = 401;
    throw err;
  }

  // ─── DEACTIVATION CHECK (before reuse detection) ───
  // If the account was deactivated after this token was issued, reject cleanly.
  // This prevents a false TOKEN_REUSE_DETECTED audit event when an admin
  // deactivates a user (which revokes all their tokens via revokeAllRefreshTokens).
  if (!storedToken.user.isActive || storedToken.user.deletedAt) {
    const err = new Error(
      "This account is inactive. Please contact your administrator.",
    );
    err.statusCode = 403;
    throw err;
  }

  // ─── REUSE DETECTION ───
  // revokedAt being set on a non-deactivated account means token theft.
  if (storedToken.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: {
        family: storedToken.family,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    await writeAuditLog({
      userId: storedToken.userId,
      schoolId: storedToken.user.schoolId,
      action: AUDIT_EVENTS.TOKEN_REUSE_DETECTED,
      ipAddress: deviceInfo.ipAddress,
      userAgent: deviceInfo.deviceName,
      metadata: {
        family: storedToken.family,
        message: "Entire token family revoked due to reuse detection",
      },
    });

    const err = new Error(
      "Token reuse detected. All sessions have been revoked for your security. Please log in again.",
    );
    err.statusCode = 401;
    throw err;
  }

  // ─── EXPIRY CHECK ───
  if (storedToken.expiresAt < new Date()) {
    const err = new Error("Refresh token has expired. Please log in again.");
    err.statusCode = 401;
    throw err;
  }

  // ─── TOKEN IS VALID — ROTATE ───

  // Atomic revoke — guards against concurrent requests racing on the same token
  const revokeResult = await prisma.refreshToken.updateMany({
    where: { id: storedToken.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  if (revokeResult.count !== 1) {
    const err = new Error(
      "Refresh token has already been used. Please log in again.",
    );
    err.statusCode = 401;
    throw err;
  }

  const newRawRefreshToken = generateRefreshToken();
  const newTokenHash = hashRefreshToken(newRawRefreshToken);

  await prisma.refreshToken.create({
    data: {
      userId: storedToken.userId,
      tokenHash: newTokenHash,
      family: storedToken.family,
      deviceName: storedToken.deviceName,
      ipAddress: deviceInfo.ipAddress || storedToken.ipAddress,
      expiresAt: getRefreshTokenExpiry(),
    },
  });

  const newAccessToken = signAccessToken({
    userId: storedToken.user.id,
    role: storedToken.user.role,
    schoolId: storedToken.user.schoolId,
  });

  await writeAuditLog({
    userId: storedToken.userId,
    schoolId: storedToken.user.schoolId,
    action: AUDIT_EVENTS.TOKEN_REFRESHED,
    ipAddress: deviceInfo.ipAddress,
    userAgent: deviceInfo.deviceName,
  });

  return {
    accessToken: newAccessToken,
    refreshToken: newRawRefreshToken,
  };
}

// ─────────────────────────────────────────────
// LOGOUT (single device)
// ─────────────────────────────────────────────
async function logout(rawRefreshToken, deviceInfo = {}) {
  if (!rawRefreshToken) return;

  const tokenHash = hashRefreshToken(rawRefreshToken);

  const storedToken = await prisma.refreshToken.findFirst({
    where: { tokenHash },
  });

  if (!storedToken) return;

  await prisma.refreshToken.update({
    where: { id: storedToken.id },
    data: { revokedAt: new Date() },
  });

  await writeAuditLog({
    userId: storedToken.userId,
    action: AUDIT_EVENTS.LOGOUT,
    ipAddress: deviceInfo.ipAddress,
    userAgent: deviceInfo.deviceName,
  });
}

// ─────────────────────────────────────────────
// LOGOUT ALL DEVICES
// ─────────────────────────────────────────────
async function logoutAll(userId, deviceInfo = {}) {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await writeAuditLog({
    userId,
    action: AUDIT_EVENTS.LOGOUT_ALL,
    ipAddress: deviceInfo.ipAddress,
    userAgent: deviceInfo.deviceName,
    metadata: { message: "All sessions revoked by user" },
  });
}

/**
 * ============================================================
 * FORGOT PASSWORD
 * ============================================================
 *
 * Route:
 * POST /auth/forgot-password
 *
 * Body:
 * {
 *   "email": "student@school.com"
 * }
 *
 * Purpose:
 * Allows a user to reset their password
 * if they forgot it.
 *
 * Flow:
 *
 * User enters email
 *          ↓
 * Find User
 *          ↓
 * Delete old password reset OTPs
 *          ↓
 * Generate new OTP
 *          ↓
 * Hash OTP
 *          ↓
 * Store OTP in database
 *          ↓
 * Send OTP email
 *          ↓
 * Success
 *
 * Security:
 *
 * We NEVER reveal whether an email exists.
 *
 * Instead of:
 * "User not found"
 *
 * We always return:
 *
 * "If an account exists, an OTP has been sent."
 *
 * This prevents attackers from discovering
 * registered email addresses.
 */
async function forgotPassword({ email }) {

  /**
   * Find user using email.
   */
  const user = await prisma.user.findUnique({
    where: { email },
  });

  /**
   * IMPORTANT SECURITY RULE
   *
   * Don't reveal whether email exists.
   *
   * If user not found,
   * still return success message.
   */
  if (!user) {
    return {
      success: true,
      message:
        "If an account exists, a password reset OTP has been sent.",
    };
  }

  /**
   * Delete all previous unused
   * password reset OTPs.
   *
   * This ensures only one active OTP
   * exists per user.
   */
  await prisma.otpVerification.deleteMany({
    where: {
      userId: user.id,
      otpType: "PASSWORD_RESET",
      usedAt: null,
    },
  });

  /**
   * Generate fresh OTP.
   */
  const otp = generateOtp();

  /**
   * Hash OTP before saving.
   *
   * Database never stores
   * raw OTP values.
   */
  const hashedOtp =
    await hashOtp(otp);

  /**
   * Save OTP in database.
   */
  await prisma.otpVerification.create({
    data: {
      userId: user.id,
      email: user.email,
      otpCode: hashedOtp,
      otpType: "PASSWORD_RESET",
      expiresAt: getOtpExpiry(),
    },
  });

  /**
   * Send email.
   */
  await enqueueEmail("password-reset-otp", { email: user.email, otp });

  /**
 * Record audit event.
 *
 * Useful when investigating:
 * - suspicious activity
 * - account recovery attempts
 * - security incidents
 */
await writeAuditLog({
  userId: user.id,
  schoolId: user.schoolId,

  action:
    AUDIT_EVENTS.PASSWORD_RESET_REQUESTED,
});

  return {
    success: true,
    message:
      "If an account exists, a password reset OTP has been sent.",
  };
}

/**
 * ============================================================
 * RESET PASSWORD
 * ============================================================
 *
 * Route:
 * POST /auth/reset-password
 *
 * Body:
 * {
 *   "email": "student@school.com",
 *   "otp": "123456",
 *   "newPassword": "Password@123"
 * }
 *
 * Purpose:
 * Verify OTP and allow user
 * to set a new password.
 *
 * Flow:
 *
 * Email + OTP + New Password
 *              ↓
 * Find User
 *              ↓
 * Find Latest Password Reset OTP
 *              ↓
 * Check Expiry
 *              ↓
 * Compare OTP Hash
 *              ↓
 * Hash New Password
 *              ↓
 * Update User Password
 *              ↓
 * Mark OTP Used
 *              ↓
 * Revoke Refresh Tokens
 *              ↓
 * Success
 */
async function resetPassword({
  email,
  otp,
  newPassword,
}) {

  /**
   * Find user.
   */
  const user =
    await prisma.user.findUnique({
      where: { email },
    });

  if (!user) {
    const err = new Error(
      "Invalid email or OTP"
    );

    err.statusCode = 400;
    throw err;
  }

  /**
   * Find latest password reset OTP.
   */
  const otpRecord =
    await prisma.otpVerification.findFirst({
      where: {
        userId: user.id,
        otpType: "PASSWORD_RESET",
        usedAt: null,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

  if (!otpRecord) {
    const err = new Error(
      "Invalid email or OTP"
    );

    err.statusCode = 400;
    throw err;
  }

  /**
   * Check expiry.
   */
  if (
    otpRecord.expiresAt <
    new Date()
  ) {
    const err = new Error(
      "OTP has expired"
    );

    err.statusCode = 400;
    throw err;
  }

  /**
   * Compare OTP against hash.
   */
  const otpMatches =
    await compareOtp(
      otp,
      otpRecord.otpCode
    );

  if (!otpMatches) {
    const err = new Error(
      "Invalid email or OTP"
    );

    err.statusCode = 400;
    throw err;
  }

  /**
   * Hash new password.
   */
  const passwordHash =
    await hashPassword(
      newPassword
    );

  /**
   * Update user password.
   */
  await prisma.user.update({
    where: {
      id: user.id,
    },
    data: {
      passwordHash,
    },
  });

  /**
   * Mark OTP as used.
   *
   * Prevents OTP reuse.
   */
  await prisma.otpVerification.update({
    where: {
      id: otpRecord.id,
    },
    data: {
      usedAt: new Date(),
    },
  });

  /**
   * Revoke all refresh tokens.
   *
   * WHY?
   *
   * Imagine attacker already has
   * a refresh token.
   *
   * User resets password.
   *
   * If refresh token remains valid,
   * attacker stays logged in.
   *
   * Therefore:
   *
   * Password Reset
   *        ↓
   * Logout All Devices
   */
  await prisma.refreshToken.updateMany({
    where: {
      userId: user.id,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });

  /**
   * Optional audit log.
   */
  await writeAuditLog({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_EVENTS.PASSWORD_RESET_SUCCESS,
  });

  return {
    success: true,
    message:
      "Password reset successfully",
  };
}

/**
 * ============================================================
 * VERIFY PASSWORD RESET OTP
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
 * Check whether password reset OTP
 * is valid before showing the
 * "Create New Password" screen.
 *
 * IMPORTANT:
 *
 * This endpoint DOES NOT:
 * - change password
 * - mark OTP used
 *
 * It only verifies validity.
 *
 * Why?
 *
 * Because user still needs
 * to submit their new password.
 *
 * Actual password reset happens
 * inside resetPassword().
 */
async function verifyResetOtp({
  email,
  otp,
}) {

  /**
   * Find user.
   */
  const user =
    await prisma.user.findUnique({
      where: { email },
    });

  if (!user) {
    const err = new Error(
      "Invalid email or OTP"
    );

    err.statusCode = 400;

    throw err;
  }

  /**
   * Find latest password reset OTP.
   */
  const otpRecord =
    await prisma.otpVerification.findFirst({
      where: {
        userId: user.id,
        otpType: "PASSWORD_RESET",
        usedAt: null,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

  if (!otpRecord) {
    const err = new Error(
      "Invalid email or OTP"
    );

    err.statusCode = 400;

    throw err;
  }

  /**
   * Check expiry.
   */
  if (
    otpRecord.expiresAt <
    new Date()
  ) {
    const err = new Error(
      "OTP has expired"
    );

    err.statusCode = 400;

    throw err;
  }

  /**
   * Compare OTP with hash.
   */
  const otpMatches =
    await compareOtp(
      otp,
      otpRecord.otpCode
    );

  if (!otpMatches) {
    const err = new Error(
      "Invalid email or OTP"
    );

    err.statusCode = 400;

    throw err;
  }

  return {
    success: true,
    message: "OTP verified successfully",
  };
}

module.exports = {
  register,
  invite,
  login,
  refresh,
  logout,
  logoutAll,
  verifyOtp,
  resendOtp,
  forgotPassword,
  resetPassword,
  verifyResetOtp,
};
