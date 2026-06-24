// =============================================================================
// STUDENT SESSION REGISTRATION ROUTES
// =============================================================================
//
// Note: These routes are mounted under /api/students in routes/index.js
//       alongside the existing students module routes.
//
//   POST /api/students/register-session        HOD — register single student
//   POST /api/students/register-session/bulk   HOD — register multiple students
//   GET  /api/students/my-session              Student — own current session
//   GET  /api/students/session/:sessionId      HOD — all students in a session
//
// =============================================================================

const express       = require("express");
const router        = express.Router();
const controller    = require("./student-registration.controller");
const  verifyToken   = require("../../middleware/auth.middleware");
const  requireRole   = require("../../middleware/role.middleware");
const  attachTenant  = require("../../middleware/tenant.middleware");

router.use(verifyToken, attachTenant);

// HOD registers students
router.post(
  "/register-session",
  requireRole("hod"),
  controller.registerStudent
);

router.post(
  "/register-session/bulk",
  requireRole("hod"),
  controller.bulkRegisterStudents
);

// Student views own session
router.get(
  "/my-session",
  requireRole("student"),
  controller.getMySession
);

// HOD views all students in a session
router.get(
  "/session/:sessionId",
  requireRole("hod"),
  controller.getStudentsInSession
);

module.exports = router;
