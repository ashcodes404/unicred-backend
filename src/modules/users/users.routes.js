const express = require("express");

const router = express.Router();

const userController = require("./users.controller");

const authenticate = require(
  "../../middleware/auth.middleware"
);

const tenantMiddleware = require(
  "../../middleware/tenant.middleware"
);

const requireRole = require(
  "../../middleware/role.middleware"
);

/**
 * USER ROUTES
 *
 * Authorization model:
 *
 * SELF ("/me"):
 *   Any authenticated role. No tenantMiddleware needed
 *   here — the target id is always the caller's own
 *   JWT-derived userId, never read from params.
 *
 * ADMIN:
 *   List/view/deactivate any user in the school.
 *   tenantMiddleware required to scope by schoolId.
 *
 * IMPORTANT ROUTE ORDERING:
 * "/me" must be registered BEFORE "/:id", otherwise
 * Express would match "me" as the :id param.
 */

/**
 * GET /users
 *
 * Admin only. Optional ?role= filter.
 */
router.get(
  "/",
  authenticate,
  tenantMiddleware,
  requireRole("admin"),
  userController.getAllUsers
);

/**
 * GET /users/me
 */
router.get(
  "/me",
  authenticate,
  userController.getOwnProfile
);

/**
 * PUT /users/me
 */
router.put(
  "/me",
  authenticate,
  userController.updateOwnProfile
);

/**
 * GET /users/:id
 *
 * Admin only.
 */
router.get(
  "/:id",
  authenticate,
  tenantMiddleware,
  requireRole("admin"),
  userController.getUserById
);

/**
 * DELETE /users/:id
 *
 * Admin only. Soft-deactivates the account.
 */
router.delete(
  "/:id",
  authenticate,
  tenantMiddleware,
  requireRole("admin"),
  userController.deactivateUser
);

module.exports = router;
