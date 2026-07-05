// =============================================================================
// FACULTY ABSENCES ROUTES
// (src/modules/faculty-absences/faculty-absences.routes.js)
// =============================================================================
//
//   POST   /api/faculty-absences                        Faculty — file leave
//   GET    /api/faculty-absences/my                      Faculty — own history
//   GET    /api/faculty-absences/department              HOD — pending in dept
//   PATCH  /api/faculty-absences/substitutions/:subId    HOD — set/clear substitute
//   PATCH  /api/faculty-absences/:id/approve             HOD — approve (+ generate classes)
//   PATCH  /api/faculty-absences/:id/reject              HOD — reject with comment
//   GET    /api/faculty-absences/:id/substitutions       HOD — affected classes
//
// Route ORDER matters in Express: specific/static paths ("/my", "/department",
// "/substitutions/:subId") are declared BEFORE the "/:id/..." patterns, so
// Express doesn't mistake the word "my" for an :id.
//
// Middleware chain: verifyToken → attachTenant → requireRole → facultyContext.
// facultyContext supplies req.faculty (id + departmentId) for both faculty and
// HOD, which every handler here relies on.
//
// =============================================================================

const express    = require("express");
const router     = express.Router();
const controller = require("./faculty-absences.controller");

const verifyToken   = require("../../middleware/auth.middleware");
const requireRole   = require("../../middleware/role.middleware");
const attachTenant  = require("../../middleware/tenant.middleware");
const { facultyContext } = require("../../middleware/facultyContext.middleware");

router.use(verifyToken, attachTenant);

// ── Faculty ────────────────────────────────────────────────────────────────
router.post("/",    requireRole("faculty", "hod"), facultyContext, controller.applyForAbsence);
router.get("/my",   requireRole("faculty", "hod"), facultyContext, controller.getMyAbsences);

// ── HOD (static paths first) ─────────────────────────────────────────────────
router.get("/department", requireRole("hod"), facultyContext, controller.getDepartmentPending);
router.patch("/substitutions/:subId", requireRole("hod"), facultyContext, controller.assignSubstitute);

// ── HOD (param paths) ────────────────────────────────────────────────────────
router.patch("/:id/approve", requireRole("hod"), facultyContext, controller.approveAbsence);
router.patch("/:id/reject",  requireRole("hod"), facultyContext, controller.rejectAbsence);
router.get("/:id/substitutions", requireRole("hod"), facultyContext, controller.getSubstitutions);

module.exports = router;
