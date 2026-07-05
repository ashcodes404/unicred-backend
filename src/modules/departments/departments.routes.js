const express = require("express");

const router = express.Router();

/**
 * =====================================================
 * CONTROLLER IMPORTS
 * =====================================================
 */
const departmentController = require(
  "./departments.controller"
);

/**
 * =====================================================
 * MIDDLEWARE IMPORTS
 * =====================================================
 */
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
 * =====================================================
 * DEPARTMENT ROUTES
 * =====================================================
 *
 * Base URL:
 *
 * /api/departments
 *
 * Request Flow:
 *
 * Route
 *   ↓
 * Authentication
 *   ↓
 * Tenant scoping (req.schoolId)
 *   ↓
 * Authorization
 *   ↓
 * Controller
 *   ↓
 * Service
 *   ↓
 * Repository
 *
 * BUGFIX (critical):
 *
 
 * The controller reads req.schoolId — which is ONLY set
 * by tenantMiddleware — so without it, req.schoolId was
 * `undefined` on every request. Prisma silently drops
 * `undefined` where-clause values instead of filtering
 * by them, meaning GET/PUT/DELETE /:id worked across
 * EVERY school, not just the caller's own. 
 */

/**
 * =====================================================
 * GET ALL DEPARTMENTS
 * =====================================================
 *
 * Route:
 *
 * GET /api/departments
 *
 * Access:
 *
 * Any authenticated user
 *
 * Reason:
 *
 * Students and Faculty need
 * to see available departments.
 */
router.get(
  "/",
  authenticate,
  tenantMiddleware,
  departmentController.getAllDepartments
);

/**
 * =====================================================
 * GET DEPARTMENT BY ID
 * =====================================================
 *
 * Route:
 *
 * GET /api/departments/:id
 *
 * Example:
 *
 * GET /api/departments/3
 */
router.get(
  "/:id",
  authenticate,
  tenantMiddleware,
  departmentController.getDepartmentById
);

/**
 * =====================================================
 * CREATE DEPARTMENT
 * =====================================================
 *
 * Route:
 *
 * POST /api/departments
 *
 * Access:
 *
 * ADMIN only
 *
 * Example Body:
 *
 * {
 *   "name": "CSE"
 * }
 */
router.post(
  "/",
  authenticate,
  tenantMiddleware,
  requireRole("admin"),
  departmentController.createDepartment
);

/**
 * =====================================================
 * RECONCILE HOD ROLES (self-heal)
 * =====================================================
 *
 * Route:
 *
 * POST /api/departments/reconcile-hods
 *
 * Access:
 *
 * ADMIN only
 *
 * Demotes any "hod" who heads no department back to
 * "faculty". Safe to run any time — does nothing when
 * data is already consistent.
 *
 * NOTE: declared BEFORE "/:id" routes is not required
 * here because those are GET, but keeping POST routes
 * grouped keeps things readable.
 */
router.post(
  "/reconcile-hods",
  authenticate,
  tenantMiddleware,
  requireRole("admin"),
  departmentController.reconcileHods
);

/**
 * =====================================================
 * UPDATE DEPARTMENT
 * =====================================================
 *
 * Route:
 *
 * PUT /api/departments/:id
 *
 * Access:
 *
 * ADMIN only
 *
 * Body (whitelisted in service layer):
 *
 * {
 *   "name": "Computer Science",
 *   "hodUserId": 25
 * }
 *
 * hodUserId can be set to null to unassign the HOD.
 */
router.put(
  "/:id",
  authenticate,
  tenantMiddleware,
  requireRole("admin"),
  departmentController.updateDepartment
);

/**
 * =====================================================
 * DELETE DEPARTMENT
 * =====================================================
 *
 * Route:
 *
 * DELETE /api/departments/:id
 *
 * Access:
 *
 * ADMIN only
 *
 * Soft Delete.
 */
router.delete(
  "/:id",
  authenticate,
  tenantMiddleware,
  requireRole("admin"),
  departmentController.deleteDepartment
);

/**
 * =====================================================
 * EXPORT ROUTER
 * =====================================================
 */
module.exports = router;