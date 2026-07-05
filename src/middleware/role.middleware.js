/**
 * ROLE AUTHORIZATION MIDDLEWARE
 *
 * Authentication answers:
 * "Who are you?"
 *
 * Authorization answers:
 * "What are you allowed to do?"
 *
 * This middleware runs AFTER auth.middleware.js.
 *
 * auth.middleware.js creates:
 *
 * req.user = {
 *   userId,
 *   role,
 *   schoolId
 * }
 *
 * This middleware checks whether the user's role
 * is allowed to access the current route.
 *
 * Example:
 *
 * router.get(
 *   "/students",
 *   authenticate,
 *   requireRole("admin", "faculty"),
 *   controller.getStudents
 * );
 *
 * Allowed:
 *   admin
 *   faculty
 *
 * Rejected:
 *   student
 *   hod
 */

const { error } = require("../utils/apiResponse");

function requireRole(...allowedRoles) {
  return (req, res, next) => {

    /*
     * req.user was attached by auth.middleware.js
     */
    const userRole = req.user?.role;

    /*
     * If user's role is not in the allowed list,
     * stop request execution.
     */
    if (!allowedRoles.includes(userRole)) {
      return error(
        res,
        403,
        "You do not have permission to access this resource"
      );
    }

    /*
     * User is authorized.
     * Continue request pipeline.
     */
    next();
  };
}

module.exports = requireRole;