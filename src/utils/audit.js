/**
 * AUDIT LOGGER UTILITY
 * =====================
 * This file provides a simple helper function to record important
 * security-related events into the AuditLog table in the database.
 *
 * WHY DO WE NEED THIS?
 * In a production app, you need a trail of "who did what, when, from where".
 * Examples:
 *   - Someone logged in from a new device
 *   - Someone tried to login 10 times with wrong password
 *   - A stolen refresh token was detected and used
 *
 * These logs help you:
 *   1. Detect security breaches
 *   2. Debug issues
 *   3. Comply with regulations (GDPR, etc.)
 *
 * HOW IT WORKS:
 * Every time something important happens (login, logout, failed login, etc.),
 * we call writeAuditLog() which inserts one row into the AuditLog table.
 * That's it — simple insert, no complex logic here.
 */

const prisma = require("../config/db");

/**
 * List of all possible audit event types.
 * Using constants instead of raw strings avoids typos like "Loginn" vs "Login".
 * Any event we want to track must be added here first.
 */
const AUDIT_EVENTS = {
  // Auth events
  LOGIN_SUCCESS: "LOGIN_SUCCESS", // user logged in successfully
  LOGIN_FAILED: "LOGIN_FAILED", // wrong email or password
  LOGOUT: "LOGOUT", // user logged out
  LOGOUT_ALL: "LOGOUT_ALL", // user logged out from all devices
  TOKEN_REFRESHED: "TOKEN_REFRESHED", // access token was refreshed using refresh token
  TOKEN_REUSE_DETECTED: "TOKEN_REUSE_DETECTED", // 🚨 a stolen/already-used token was detected
  REGISTER: "REGISTER", // new user registered
  PASSWORD_RESET_REQUESTED: "PASSWORD_RESET_REQUESTED",
  PASSWORD_RESET_SUCCESS: "PASSWORD_RESET_SUCCESS",
};

/**
 * Writes one audit log entry to the database.
 *
 * @param {Object} options
 * @param {number|null} options.userId    - ID of the user this event is about (null for failed logins where user may not exist)
 * @param {number|null} options.schoolId  - School this user belongs to (for multi-tenant filtering)
 * @param {string} options.action         - What happened (use AUDIT_EVENTS constants above)
 * @param {string|null} options.ipAddress - IP address the request came from (req.ip in Express)
 * @param {string|null} options.userAgent - Browser/client info (req.headers['user-agent'])
 * @param {Object|null} options.metadata  - Any extra info you want to store as JSON (e.g. { reason: "wrong password" })
 *
 * NOTE: This function NEVER throws an error.
 * We use try/catch and just log to console if it fails.
 * WHY? Because if audit logging fails, we don't want to break the actual
 * login/logout flow for the user. Logging is important but not critical.
 */
async function writeAuditLog({
  userId = null,
  schoolId = null,
  action,
  ipAddress = null,
  userAgent = null,
  metadata = null,
}) {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        schoolId,
        action,
        ipAddress,
        userAgent,
        // Store extra info as a JSON string (e.g. '{"reason":"wrong password"}')
        metadata: metadata || null,
      },
    });
  } catch (err) {
    // If audit log fails, just print to server console — don't crash the app
    console.error("[AuditLog] Failed to write audit log:", err.message);
  }
}

module.exports = {
  writeAuditLog,
  AUDIT_EVENTS,
};
