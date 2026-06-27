const prisma = require("../../config/db");

/**
 * USER REPOSITORY
 *
 * Responsibilities:
 * - Execute Prisma queries
 * - Return raw database data
 * - NO business logic
 * - NO authorization logic
 * - NO HTTP logic
 *
 * SECURITY NOTE:
 *
 * Every query below uses `select` (never the default
 * "return everything") so that `passwordHash` can
 * never accidentally leak into an API response.
 */
const SAFE_USER_FIELDS = {
  id: true,
  schoolId: true,
  email: true,
  role: true,
  name: true,
  bio: true,
  profilePhotoUrl: true,
  linkedinUrl: true,
  githubUrl: true,
  portfolioUrl: true,
  phoneNumber: true,
  emailVerified: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
};

/**
 * Find a user by their own id.
 *
 * Used for "/me" routes — the id always comes from
 * the JWT (req.user.userId), never from frontend input,
 * so no schoolId scoping is needed here.
 */
async function findByUserId(userId) {
  return prisma.user.findFirst({
    where: {
      id: userId,
      deletedAt: null,
    },

    select: SAFE_USER_FIELDS,
  });
}

/**
 * Find a user by id, scoped to a school.
 *
 * Used by admin-only routes. Prevents School A admin
 * from looking up School B's users.
 */
async function findById(userId, schoolId) {
  return prisma.user.findFirst({
    where: {
      id: userId,
      schoolId,
      deletedAt: null,
    },

    select: SAFE_USER_FIELDS,
  });
}

/**
 * List all users in a school.
 *
 * Optional role filter, e.g. findAllBySchool(5, "faculty")
 * to see only faculty accounts.
 */
async function findAllBySchool(schoolId, role) {
  return prisma.user.findMany({
    where: {
      schoolId,
      deletedAt: null,
      ...(role && { role }),
    },

    select: SAFE_USER_FIELDS,

    orderBy: {
      name: "asc",
    },
  });
}

/**
 * Update a user's own profile fields.
 *
 * Scoped to id only — the id is the caller's own
 * JWT-derived id, so no schoolId check is needed.
 * deletedAt: null guards against editing a
 * deactivated account.
 */
async function updateSelf(userId, updateData) {
  return prisma.user.updateMany({
    where: {
      id: userId,
      deletedAt: null,
    },

    data: updateData,
  });
}

/**
 * Update ONLY a user's role.
 *
 * Used by the HOD reconciliation logic to promote a
 * faculty to "hod", or demote a former HOD back to
 * "faculty". Scoped by schoolId so one school can never
 * change another school's user.
 *
 * prisma.user.updateMany() is a built-in Prisma method
 * that updates every row matching `where`. We use the
 * "Many" variant (not update()) so we can add the
 * schoolId + deletedAt guards — plain update() only
 * accepts a single unique id with no extra filters.
 */
async function updateRole(userId, schoolId, role) {
  return prisma.user.updateMany({
    where: {
      id: userId,
      schoolId,
      deletedAt: null,
    },

    data: { role },
  });
}

/**
 * Soft-deactivate a user (admin only).
 *
 * We never hard-delete a User row — Student/Faculty
 * records and historical data (audit logs, resumes,
 * achievements) reference it via foreign keys.
 */
async function deactivateUser(userId, schoolId) {
  return prisma.user.updateMany({
    where: {
      id: userId,
      schoolId,
      deletedAt: null,
    },

    data: {
      isActive: false,
      deletedAt: new Date(),
    },
  });
}

/**
 * Revoke every active refresh token belonging to a user.
 *
 * Why this matters:
 *
 * Access tokens are stateless JWTs — auth.middleware.js
 * only checks signature/expiry, never the database. So
 * deactivating a user alone doesn't stop them; their
 * still-valid refresh token can keep minting fresh
 * access tokens until it expires on its own.
 *
 * Calling this immediately on deactivation closes that
 * window — the next refresh attempt finds no usable
 * token and fails.
 */
async function revokeAllRefreshTokens(userId) {
  return prisma.refreshToken.updateMany({
    where: {
      userId,
      revokedAt: null,
    },

    data: {
      revokedAt: new Date(),
    },
  });
}

module.exports = {
  findByUserId,
  findById,
  findAllBySchool,
  updateSelf,
  updateRole,
  deactivateUser,
  revokeAllRefreshTokens,
};