const express = require("express");

const router = express.Router();

const facultyController = require(
  "./faculty.controller"
);

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
 * FACULTY ROUTES
 *
 * Authorization model:
 *
 * READS (list + single record):
 *   admin, hod, faculty, student — everyone in the
 *   school can browse the faculty directory.
 *
 * WRITES (create, update, delete):
 *   admin only.
 *
 * SELF-COMPLETION:
 *   faculty, hod — both complete their own Faculty
 *   profile after registration.
 */

/**
 * GET /faculty
 *
 * School-wide directory. Supports ?departmentId=
 * to narrow results to one department.
 */
router.get(
  "/",
  authenticate,
  tenantMiddleware,
  requireRole("admin", "hod", "faculty", "student"),
  facultyController.getAllFaculty
);

/**
 * =====================================================
 * COMPLETE FACULTY PROFILE
 * =====================================================
 *
 * POST /faculty/profile
 *
 * Access:
 * - faculty
 * - hod
 *
 * Both roles teach and need a Faculty row
 * (department + designation).
 */
router.post(
  "/profile",
  authenticate,
  requireRole("faculty", "hod"),
  facultyController.completeFacultyProfile
);

/**
 * GET /faculty/:id
 *
 * Same open-read policy as the list endpoint.
 */
router.get(
  "/:id",
  authenticate,
  tenantMiddleware,
  requireRole("admin", "hod", "faculty", "student"),
  facultyController.getFacultyById
);

/**
 * POST /faculty
 *
 * Admin directly creates a faculty record for an
 * existing user.
 */
router.post(
  "/",
  authenticate,
  tenantMiddleware,
  requireRole("admin"),
  facultyController.createFaculty
);

/**
 * PUT /faculty/:id
 *
 * Admin only. Faculty/HOD never edit their own record
 * here — identity fields (bio, photo, links) live in
 * the Users module instead.
 */
router.put(
  "/:id",
  authenticate,
  tenantMiddleware,
  requireRole("admin"),
  facultyController.updateFaculty
);

/**
 * DELETE /faculty/:id
 *
 * Admin only.
 */
router.delete(
  "/:id",
  authenticate,
  tenantMiddleware,
  requireRole("admin"),
  facultyController.deleteFaculty
);

module.exports = router;
