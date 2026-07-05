const express = require("express");

const router = express.Router();

const {
  getAllStudents,
  getStudentById,
  createStudent,
  updateStudent,
  deleteStudent,
  completeStudentProfile,
  getMyStudentProfile,
  getStudentsByFilters,
} = require("./students.controller");

const authenticate = require("../../middleware/auth.middleware");

const tenantMiddleware = require("../../middleware/tenant.middleware");

const requireRole = require("../../middleware/role.middleware");

/**
 * STUDENT ROUTES
 *
 * Request Flow:
 *
 * Client
 *   ↓
 * Route
 *   ↓
 * authenticate()
 *   ↓
 * tenantMiddleware()
 *   ↓
 * requireRole()
 *   ↓
 * Controller
 *   ↓
 * Service
 *   ↓
 * Repository
 *   ↓
 * Prisma
 *   ↓
 * Database
 */

/**
 * GET /students
 *
 * Allowed:
 * - admin
 * - faculty
 * - hod
 *
 * Not allowed:
 * - student
 */
router.get(
  "/",
  authenticate,
  tenantMiddleware,
  requireRole("admin", "faculty", "hod"),
  getAllStudents,
);

/**
 * =====================================================
 * COMPLETE STUDENT PROFILE
 * =====================================================
 *
 * Route:
 *
 * POST /students/profile
 *
 * Access:
 *
 * STUDENT only
 *
 * Purpose:
 *
 * Registration creates User.
 *
 * This endpoint creates
 * Student record.
 */
router.post(
  "/profile",
  authenticate,
  requireRole("student"),
  completeStudentProfile,
);

/**
 * GET /students/:id
 *
 * Allowed:
 * - admin
 * - faculty
 * - hod
 */

/**
 * =====================================================
 * GET MY STUDENT PROFILE
 * =====================================================
 *
 * Route:
 *
 * GET /students/profile/me
 *
 * Access:
 *
 * STUDENT only
 *
 * Purpose:
 *
 * Lets a logged-in student check whether
 * they've already completed their profile.
 *
 * MUST be registered before /:id route,
 * otherwise Express matches "profile" as an :id param.
 */
router.get(
  "/profile/me",
  authenticate,
  requireRole("student"),
  getMyStudentProfile,
);

/**
 * GET /students/filter
 *
 * Filter students by department, batch year, and/or semester number.
 * All query params are optional — mix and match as needed:
 *
 *   ?departmentId=3
 *   ?batchYear=2022
 *   ?semesterNumber=5
 *   ?departmentId=3&batchYear=2022&semesterNumber=5
 *
 * IMPORTANT — this route MUST be registered before "/:id".
 * Express matches routes top-to-bottom. If "/:id" came first,
 * a request to "/filter" would be treated as id = "filter"
 * and hit the wrong handler.
 *
 * Allowed: admin, faculty, hod
 */
router.get(
  "/filter",
  authenticate,
  tenantMiddleware,
  requireRole("admin", "faculty", "hod"),
  getStudentsByFilters,
);

router.get(
  "/:id",
  authenticate,
  tenantMiddleware,
  requireRole("admin", "faculty", "hod", "student"),
  getStudentById,
);

/**
 * POST /students
 *
 * Usually only admin creates students.
 */
router.post(
  "/",
  authenticate,
  tenantMiddleware,
  requireRole("admin"),
  createStudent,
);

/**
 * PUT /students/:id
 *
 * Allowed:
 * - admin
 * - hod
 */
router.put(
  "/:id",
  authenticate,
  tenantMiddleware,
  requireRole("admin", "hod"),
  updateStudent,
);

/**
 * DELETE /students/:id
 *
 * Only admin can delete.
 */
router.delete(
  "/:id",
  authenticate,
  tenantMiddleware,
  requireRole("admin"),
  deleteStudent,
);

module.exports = router;
