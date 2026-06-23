const express = require("express");

const router = express.Router();

const {
  getAllStudents,
  getStudentById,
  createStudent,
  updateStudent,
  deleteStudent,
  completeStudentProfile,
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
