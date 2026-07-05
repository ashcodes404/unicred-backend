// =============================================================================
// ADMIN TIMETABLE ROUTES  (src/modules/timetables/timetables.admin.routes.js)
// =============================================================================
//
//   GET    /api/admin/timetables               Admin — list submitted
//   PATCH  /api/admin/timetables/:id/approve    Admin — approve
//   PATCH  /api/admin/timetables/:id/return     Admin — return with comment
//
// These are the admin side of the workflow. Admin reviews EVERY department in
// the school, so there is no facultyContext / department scoping here — only
// the "admin" role guard plus school isolation from attachTenant.
//
// =============================================================================

const express    = require("express");
const router     = express.Router();
const controller = require("./timetables.controller");

const verifyToken  = require("../../middleware/auth.middleware");
const requireRole  = require("../../middleware/role.middleware");
const attachTenant = require("../../middleware/tenant.middleware");

// Require a valid login, school context, and the admin role for all routes.
router.use(verifyToken, attachTenant, requireRole("admin"));

router.get("/",             controller.getSubmittedTimetables);
router.patch("/:id/approve", controller.approveTimetable);
router.patch("/:id/return",  controller.returnTimetable);

module.exports = router;
