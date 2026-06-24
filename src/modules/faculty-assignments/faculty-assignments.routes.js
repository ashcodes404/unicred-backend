// =============================================================================
// FACULTY ASSIGNMENTS ROUTES
// =============================================================================
//
//   POST   /api/faculty/assignments        HOD — assign faculty to subject
//   GET    /api/faculty/assignments        HOD — list all assignments (dept)
//   GET    /api/faculty/assignments/my     Faculty — own assignments
//   PATCH  /api/faculty/assignments/:id    HOD — modify assignment
//   DELETE /api/faculty/assignments/:id    HOD — remove assignment
//
// =============================================================================

const express       = require("express");
const router        = express.Router();
const controller    = require("./faculty-assignments.controller");
const  verifyToken     = require("../../middleware/auth.middleware");
const  requireRole     = require("../../middleware/role.middleware");
const  attachTenant    = require("../../middleware/tenant.middleware");
const { facultyContext } = require("../../middleware/facultyContext.middleware");

router.use(verifyToken, attachTenant);

// IMPORTANT: /my must come before /:id to avoid Express treating "my" as an ID
router.get(
  "/my",
  requireRole("faculty", "hod"),
  controller.getMyAssignments
);

router.post(
  "/",
  requireRole("hod"),
  facultyContext,
  controller.createAssignment
);

router.get(
  "/",
  requireRole("hod"),
  facultyContext,
  controller.getAllAssignments
);

router.patch(
  "/:id",
  requireRole("hod"),
  facultyContext,
  controller.updateAssignment
);

router.delete(
  "/:id",
  requireRole("hod"),
  facultyContext,
  controller.deleteAssignment
);

module.exports = router;
