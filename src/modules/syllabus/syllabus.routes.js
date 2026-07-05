// =============================================================================
// SYLLABUS ROUTES  (mounted at /api/syllabus)
// =============================================================================
//
//   GET    /api/syllabus        HOD/faculty/student — own department's syllabus
//   POST   /api/syllabus        HOD — add a syllabus file to a subject
//   PATCH  /api/syllabus/:id     HOD — replace/rename a syllabus file
//   DELETE /api/syllabus/:id     HOD — delete a syllabus file
//
// Read is department-scoped in the service (each caller only ever sees their
// own department). Writes are HOD-only, scoped to the HOD's department via
// facultyContext.
// =============================================================================

const express = require("express");
const router = express.Router();

const verifyToken = require("../../middleware/auth.middleware");
const attachTenant = require("../../middleware/tenant.middleware");
const requireRole = require("../../middleware/role.middleware");
const { facultyContext } = require("../../middleware/facultyContext.middleware");
const { syllabusRateLimiter } = require("../../middleware/rateLimit.middleware");

const controller = require("./syllabus.controller");

router.use(verifyToken, attachTenant);

// View — any member of a department (service scopes to their own department).
router.get("/", requireRole("hod", "faculty", "student"), controller.list);

// Manage — HOD only, scoped to their department. Rate-limited: create/update
// both fan out a SYLLABUS_UPDATED notification to every faculty + student in
// the department (see syllabus.service.js's notifyDepartmentOfSyllabus), the
// same larger blast radius announcements got a limiter for.
router.post("/", requireRole("hod"), syllabusRateLimiter, facultyContext, controller.create);
router.patch("/:id", requireRole("hod"), syllabusRateLimiter, facultyContext, controller.update);
router.delete("/:id", requireRole("hod"), facultyContext, controller.remove);

module.exports = router;
