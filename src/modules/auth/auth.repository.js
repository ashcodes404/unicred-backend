/**
 * AUTH REPOSITORY
 * ================
 * All database operations for the auth module live here.
 * auth.service.js calls these functions — it never touches Prisma directly.
 *
 * This separation means:
 *   - Service handles business logic (what to do)
 *   - Repository handles data access (how to do it)
 *   - If you ever swap Prisma for something else, only this file changes
 *
 * Field names are matched exactly to schema.prisma:
 *   School      → id, name, domain, createdAt, updatedAt, deletedAt
 *   User        → id, schoolId, email, role, name, passwordHash, isActive,
 *                 deletedAt, lastLoginAt, emailVerified, ...
 *   RefreshToken → id, userId, tokenHash, family, deviceName, ipAddress,
 *                  expiresAt, revokedAt, createdAt
 *   AuditLog    → id, userId, schoolId, action, metadata, ipAddress,
 *                 userAgent, createdAt
 */

const prisma = require("../../config/db");

// ─────────────────────────────────────────────
// SCHOOL
// ─────────────────────────────────────────────

/**
 * Find a school by its email domain.
 * Used during student self-registration to resolve schoolId from email.
 *
 * Schema field: School.domain (not emailDomain)
 *
 * @param {string} domain  e.g. "nitkkr.ac.in"
 * @returns {Promise<School|null>}
 */
async function findSchoolByDomain(domain) {
  return prisma.school.findFirst({
    where: { domain },
    select: { id: true, name: true, domain: true },
  });
}

/**
 * Find a school by its primary key.
 * Used in invite() to confirm the admin's schoolId is valid.
 *
 * @param {number} id
 * @returns {Promise<School|null>}
 */
async function findSchoolById(id) {
  return prisma.school.findUnique({
    where: { id },
    select: { id: true, name: true, domain: true },
  });
}

// ─────────────────────────────────────────────
// USER
// ─────────────────────────────────────────────

/**
 * Find a user by email.
 * Used in login() and register() to check for duplicates.
 *
 * Never returns passwordHash — callers that need it use findUserByEmailWithPassword().
 *
 * @param {string} email
 * @returns {Promise<User|null>}
 */
async function findUserByEmail(email) {
  return prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      schoolId: true,
      isActive: true,
      deletedAt: true,
      emailVerified: true,
    },
  });
}

/**
 * Find a user by email, including passwordHash.
 * Used ONLY in login() for password comparison.
 * Keep this separate so passwordHash never leaks into other queries.
 *
 * @param {string} email
 * @returns {Promise<User|null>}
 */
async function findUserByEmailWithPassword(email) {
  return prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      schoolId: true,
      isActive: true,
      deletedAt: true,
      passwordHash: true, // only query that returns this
    },
  });
}

/**
 * Find a user by primary key.
 * Used in invite() sanity checks and users module.
 *
 * @param {number} id
 * @returns {Promise<User|null>}
 */
async function findUserById(id) {
  return prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      schoolId: true,
      isActive: true,
      deletedAt: true,
      emailVerified: true,
    },
  });
}

/**
 * Create a new user.
 * Used by register() (role hardcoded to "student") and invite() (role from admin).
 *
 * @param {{ email, passwordHash, name, role, schoolId }} data
 * @returns {Promise<User>}
 */
async function createUser({ email, passwordHash, name, role, schoolId }) {
  return prisma.user.create({
    data: { email, passwordHash, name, role, schoolId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      schoolId: true,
    },
  });
}

/**
 * Update a user's lastLoginAt timestamp.
 * Called after a successful login.
 *
 * @param {number} id
 * @returns {Promise<void>}
 */
async function updateLastLogin(id) {
  await prisma.user.update({
    where: { id },
    data: { lastLoginAt: new Date() },
  });
}

// ─────────────────────────────────────────────
// REFRESH TOKEN
// ─────────────────────────────────────────────

/**
 * Store a new refresh token in the database.
 * Raw token is NEVER stored — only the hash.
 *
 * @param {{ userId, tokenHash, family, deviceName, ipAddress, expiresAt }} data
 * @returns {Promise<RefreshToken>}
 */
async function createRefreshToken({ userId, tokenHash, family, deviceName, ipAddress, expiresAt }) {
  return prisma.refreshToken.create({
    data: { userId, tokenHash, family, deviceName, ipAddress, expiresAt },
  });
}

/**
 * Find a refresh token by its hash, including the owning user.
 * Used in refresh() to validate and rotate the token.
 *
 * @param {string} tokenHash
 * @returns {Promise<RefreshToken & { user: User }|null>}
 */
async function findRefreshTokenByHash(tokenHash) {
  return prisma.refreshToken.findFirst({
    where: { tokenHash },
    include: {
      user: {
        select: {
          id: true,
          role: true,
          schoolId: true,
          isActive: true,
          deletedAt: true,
        },
      },
    },
  });
}

/**
 * Atomically revoke a single refresh token.
 * Uses updateMany with revokedAt: null guard to prevent double-revocation
 * (two concurrent requests racing on the same token).
 *
 * Returns the count of updated rows — if 0, the token was already revoked
 * by another concurrent request.
 *
 * @param {number} id
 * @returns {Promise<number>}  number of rows updated (0 or 1)
 */
async function revokeRefreshToken(id) {
  const result = await prisma.refreshToken.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/**
 * Revoke all active tokens in a token family.
 * Used in reuse detection — when a stolen token is replayed,
 * we nuke the entire login chain to force re-authentication
 * on all devices.
 *
 * @param {string} family  UUID that groups a login chain together
 * @returns {Promise<void>}
 */
async function revokeTokenFamily(family) {
  await prisma.refreshToken.updateMany({
    where: { family, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Revoke all active refresh tokens for a user.
 * Used in logoutAll() and when an admin deactivates a user.
 *
 * @param {number} userId
 * @returns {Promise<void>}
 */
async function revokeAllUserRefreshTokens(userId) {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// ─────────────────────────────────────────────
// AUDIT LOG
// ─────────────────────────────────────────────

/**
 * Write an audit log entry.
 * All fields are optional except action — so partial info
 * (e.g. a failed login before we know the userId) can still be logged.
 *
 * @param {{ userId?, schoolId?, action, ipAddress?, userAgent?, metadata? }} data
 * @returns {Promise<void>}
 */
async function writeAuditLog({ userId, schoolId, action, ipAddress, userAgent, metadata }) {
  await prisma.auditLog.create({
    data: {
      userId:    userId    ?? null,
      schoolId:  schoolId  ?? null,
      action,
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
      metadata:  metadata  ?? null,
    },
  });
}

module.exports = {
  // School
  findSchoolByDomain,
  findSchoolById,

  // User
  findUserByEmail,
  findUserByEmailWithPassword,
  findUserById,
  createUser,
  updateLastLogin,

  // Refresh token
  createRefreshToken,
  findRefreshTokenByHash,
  revokeRefreshToken,
  revokeTokenFamily,
  revokeAllUserRefreshTokens,

  // Audit log
  writeAuditLog,
};