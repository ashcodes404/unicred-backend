// =============================================================================
// COURSES ROUTES
// =============================================================================
//
// Route summary:
//
//   SUBJECTS
//   POST   /api/courses                        HOD — create subject
//   GET    /api/courses                        HOD — list dept subjects
//   GET    /api/courses/:id                    HOD — single subject (dept scoped)
//   GET    /api/courses/:id/view               All — single subject (any role)
//   PATCH  /api/courses/:id                    HOD — update subject
//   PATCH  /api/courses/:id/deactivate         HOD — deactivate subject
//
//   OFFERINGS
//   POST   /api/courses/offerings              HOD — create offering
//   GET    /api/courses/offerings/:sessionId   HOD/Faculty — list by session
//   DELETE /api/courses/offerings/:offeringId  HOD — remove offering
//
// =============================================================================

const express       = require("express");
const router        = express.Router();
const controller    = require("./courses.controller");
const  verifyToken    = require("../../middleware/auth.middleware");
const  requireRole     = require("../../middleware/role.middleware");
const  attachTenant    = require("../../middleware/tenant.middleware");
const { facultyContext } = require("../../middleware/facultyContext.middleware");

router.use(verifyToken, attachTenant);

// ── Subjects ──────────────────────────────────────────────────────────────────

router.post(
  "/",
  requireRole("hod"),
  facultyContext,
  controller.createSubject
);

router.get(
  "/",
  requireRole("hod"),
  facultyContext,
  controller.getAllSubjects
);

// IMPORTANT: /offerings routes must come before /:id to avoid Express
// interpreting "offerings" as an :id parameter
router.post(
  "/offerings",
  requireRole("hod"),
  facultyContext,
  controller.createOffering
);

router.get(
  "/offerings/:sessionId",
  requireRole("hod", "faculty" , "student"),
  controller.getOfferings
);

router.delete(
  "/offerings/:offeringId",
  requireRole("hod"),
  controller.deleteOffering
);

// /:id routes after /offerings to avoid route conflicts
router.get(
  "/:id",
  requireRole("hod"),
  facultyContext,
  controller.getSubjectById
);

// Any authenticated role views subject details (for student subject page)
router.get(
  "/:id/view",
  requireRole("student", "faculty", "hod", "admin"),
  controller.getSubjectForAnyRole
);

router.patch(
  "/:id",
  requireRole("hod"),
  facultyContext,
  controller.updateSubject
);

router.patch(
  "/:id/deactivate",
  requireRole("hod"),
  facultyContext,
  controller.deactivateSubject
);

module.exports = router;
