const userService = require("./users.service");

const {
  success,
  error,
} = require("../../utils/apiResponse");

/**
 * USER CONTROLLER
 *
 * Responsibilities:
 * - Read request data
 * - Call service layer
 * - Send HTTP response
 *
 * Never:
 * - Write Prisma queries
 * - Write authorization logic
 * - Write business logic
 */

/**
 * GET /users/me
 *
 * Returns the logged-in user's own profile.
 */
async function getOwnProfile(req, res) {
  try {
    const user = await userService.getOwnProfile(
      req.user
    );

    return success(
      res,
      200,
      "Profile fetched successfully",
      user
    );
  } catch (err) {
    return error(
      res,
      404,
      err.message
    );
  }
}

/**
 * PUT /users/me
 *
 * Updates the logged-in user's own profile.
 *
 * Only identity fields (name, bio, profilePhotoUrl,
 * linkedinUrl, githubUrl, portfolioUrl, phoneNumber)
 * can be changed here — email, role, and schoolId
 * are never accepted from frontend.
 */
async function updateOwnProfile(req, res) {
  try {
    const user = await userService.updateOwnProfile(
      req.user,
      req.body
    );

    return success(
      res,
      200,
      "Profile updated successfully",
      user
    );
  } catch (err) {
    return error(
      res,
      400,
      err.message
    );
  }
}

/**
 * GET /users
 *
 * Admin only. Lists all users in the school.
 * Optional ?role= query filters by role.
 */
async function getAllUsers(req, res) {
  try {
    const role = req.query.role;

    const users = await userService.getAllUsers(
      req.schoolId,
      role,
      req.query
    );

    return success(
      res,
      200,
      "Users fetched successfully",
      users
    );
  } catch (err) {
    return error(
      res,
      500,
      err.message
    );
  }
}

/**
 * GET /users/:id
 *
 * Admin only. Views any single user in the school.
 */
async function getUserById(req, res) {
  try {
    const userId = Number(req.params.id);

    const user = await userService.getUserById(
      userId,
      req.schoolId
    );

    return success(
      res,
      200,
      "User fetched successfully",
      user
    );
  } catch (err) {
    return error(
      res,
      404,
      err.message
    );
  }
}

/**
 * DELETE /users/:id
 *
 * Admin only. Soft-deactivates a user account.
 */
async function deactivateUser(req, res) {
  try {
    const userId = Number(req.params.id);

    const result = await userService.deactivateUser(
      userId,
      req.schoolId
    );

    return success(
      res,
      200,
      result.message
    );
  } catch (err) {
    return error(
      res,
      400,
      err.message
    );
  }
}

module.exports = {
  getOwnProfile,
  updateOwnProfile,
  getAllUsers,
  getUserById,
  deactivateUser,
};
