// =============================================================================
// ACHIEVEMENTS ROUTES   (mounted at /api/achievements)  — multi-faculty
// =============================================================================
//
//   STUDENT (owns the achievement)
//   POST   /api/achievements                      create + pick faculties (facultyIds[])
//   GET    /api/achievements/my                   own list (paginated, with reviews)
//   GET    /api/achievements/:id                  own single
//   PATCH  /api/achievements/:id                  edit text/url (pending only)
//   DELETE /api/achievements/:id                  delete (pending only)
//   POST   /api/achievements/:id/reviewers        add faculties (pending only)
//   DELETE /api/achievements/:id/reviewers/:facultyId  remove a pending reviewer
//
//   FACULTY (only achievements sent to them)
//   GET    /api/achievements/assigned             my review queue (?status=pending|all)
//   GET    /api/achievements/:id/review           review detail (+ other faculties' verdicts)
//   PATCH  /api/achievements/:id/verify           approve (remark optional)
//   PATCH  /api/achievements/:id/reject           reject (remark REQUIRED)
//
//   HOD (read-only dashboard)
//   GET    /api/achievements/department            all in HOD's department
//
// ROUTE ORDER: fixed words ("my", "assigned", "department") and the more
// specific "/:id/..." routes are declared BEFORE the bare dynamic "/:id".
// =============================================================================

const express = require("express");
const router  = express.Router();

const authenticate   = require("../../middleware/auth.middleware");
const requireRole    = require("../../middleware/role.middleware");
const studentContext = require("../../middleware/studentContext.middleware"); // default export
const { facultyContext } = require("../../middleware/facultyContext.middleware"); // named export

const c = require("./achievements.controller");

router.use(authenticate);

// ── Student fixed paths ──────────────────────────────────────────────────────
router.post("/",  requireRole("student"), studentContext, c.create);
router.get("/my", requireRole("student"), studentContext, c.getMy);

// ── Faculty queue (fixed word, before "/:id") ────────────────────────────────
router.get("/assigned", requireRole("faculty", "hod"), facultyContext, c.getAssigned);

// ── HOD dashboard ────────────────────────────────────────────────────────────
router.get("/department", requireRole("hod"), facultyContext, c.getDepartment);

// ── Reviewer management (student) — specific "/:id/reviewers..." first ───────
router.post("/:id/reviewers",            requireRole("student"), studentContext, c.addReviewers);
router.delete("/:id/reviewers/:facultyId", requireRole("student"), studentContext, c.removeReviewer);

// ── Faculty actions on one achievement ───────────────────────────────────────
router.get("/:id/review",   requireRole("faculty", "hod"), facultyContext, c.getReviewDetail);
router.patch("/:id/verify", requireRole("faculty", "hod"), facultyContext, c.verify);
router.patch("/:id/reject", requireRole("faculty", "hod"), facultyContext, c.reject);

// ── Student single + edits (bare dynamic "/:id" LAST) ────────────────────────
router.get("/:id",    requireRole("student"), studentContext, c.getMyById);
router.patch("/:id",  requireRole("student"), studentContext, c.update);
router.delete("/:id", requireRole("student"), studentContext, c.remove);

module.exports = router;