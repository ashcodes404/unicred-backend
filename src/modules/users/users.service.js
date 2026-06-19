const userRepository = require("./users.repository");

/**
 * USER SERVICE
 *
 * Responsibilities:
 * - Business logic
 * - Validation
 * - Orchestration
 *
 * Never:
 * - Read req.body
 * - Read req.params
 * - Send HTTP responses
 *
 * =====================================================
 * AUTHORIZATION MODEL FOR THIS RESOURCE
 * =====================================================
 *
 * SELF ("/me" routes):
 *   Any authenticated role can view and edit their own
 *   User record — but only the identity fields below.
 *   This is where Faculty/Student self-editing of
 *   bio, photo, and contact links actually happens
 *   (Faculty/Student tables themselves stay
 *   admin-managed only).
 *
 * ADMIN routes:
 *   List/view any user in the school, and deactivate
 *   an account. Role itself is NEVER editable after
 *   registration — changing it would orphan whatever
 *   Student/Faculty row already exists for that user.
 */

/**
 * Fields a user is allowed to edit on themselves.
 *
 * Everything else on the User table (email, role,
 * schoolId, isActive, passwordHash, emailVerified) is
 * either admin-only or belongs to a dedicated flow
 * (auth/email-verification) outside this module.
 */
const SELF_EDITABLE_FIELDS = [
  "name",
  "bio",
  "profilePhotoUrl",
  "linkedinUrl",
  "githubUrl",
  "portfolioUrl",
  "phoneNumber",
];

/**
 * =====================================================
 * GET OWN PROFILE
 * =====================================================
 */
async function getOwnProfile(currentUser) {
  const user = await userRepository.findByUserId(
    currentUser.userId
  );

  if (!user) {
    throw new Error("User not found");
  }

  return user;
}

/**
 * =====================================================
 * UPDATE OWN PROFILE
 * =====================================================
 *
 * Whitelists the request body down to
 * SELF_EDITABLE_FIELDS before writing.
 *
 * Uses `!== undefined` (not a truthy check) so that a
 * user can intentionally clear a field — e.g. submitting
 * bio: "" to remove their bio — without it being
 * silently ignored.
 */
async function updateOwnProfile(currentUser, updateData) {
  const whitelisted = {};

  for (const field of SELF_EDITABLE_FIELDS) {
    if (updateData[field] !== undefined) {
      whitelisted[field] = updateData[field];
    }
  }

  await userRepository.updateSelf(
    currentUser.userId,
    whitelisted
  );

  return userRepository.findByUserId(currentUser.userId);
}

/**
 * =====================================================
 * GET ALL USERS (Admin)
 * =====================================================
 *
 * role is optional — e.g. ?role=faculty to see only
 * faculty accounts.
 */
async function getAllUsers(schoolId, role) {
  return userRepository.findAllBySchool(schoolId, role);
}

/**
 * =====================================================
 * GET USER BY ID (Admin)
 * =====================================================
 */
async function getUserById(userId, schoolId) {
  const user = await userRepository.findById(userId, schoolId);

  if (!user) {
    throw new Error("User not found");
  }

  return user;
}

/**
 * =====================================================
 * DEACTIVATE USER (Admin)
 * =====================================================
 *
 * Soft delete. The user can no longer log in
 * (auth.middleware should reject deletedAt != null /
 * isActive === false at login), but their historical
 * records stay intact.
 */
async function deactivateUser(userId, schoolId) {
  const existingUser = await userRepository.findById(
    userId,
    schoolId
  );

  if (!existingUser) {
    throw new Error("User not found");
  }

  await userRepository.deactivateUser(userId, schoolId);

  /**
   * Close the stateless-JWT window: kill every refresh
   * token this user holds so they can't mint new access
   * tokens after being deactivated, even if their current
   * access token hasn't expired yet.
   */
  await userRepository.revokeAllRefreshTokens(userId);

  return {
    success: true,
    message: "User deactivated successfully",
  };
}

module.exports = {
  getOwnProfile,
  updateOwnProfile,
  getAllUsers,
  getUserById,
  deactivateUser,
};