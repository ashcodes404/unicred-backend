// =============================================================================
// INTERNSHIPS ROUTES   (mounted at /api/internships)
// =============================================================================
//
// Route summary:
//
//   STUDENT (owns the internship)
//   POST   /api/internships                       create
//   GET    /api/internships/my                    own list (paginated)
//   GET    /api/internships/:id                   own single (+ achievement.status)
//   PATCH  /api/internships/:id                   edit
//   DELETE /api/internships/:id                   delete
//   PATCH  /api/internships/:id/link-achievement  link to an existing achievement
//
//   HOD (read-only dashboard)
//   GET    /api/internships/department            all in HOD's department
//
// ROUTE ORDER: fixed words ("my", "department") and the more specific
// "/:id/link-achievement" are declared BEFORE the bare dynamic "/:id".
// =============================================================================

const express = require("express");
const router  = express.Router();

const authenticate   = require("../../middleware/auth.middleware");
const requireRole    = require("../../middleware/role.middleware");
const studentContext = require("../../middleware/studentContext.middleware"); // default export
const { facultyContext } = require("../../middleware/facultyContext.middleware"); // named export

const c = require("./internships.controller");

router.use(authenticate);

// ── Student fixed paths ──────────────────────────────────────────────────────
router.post("/",  requireRole("student"), studentContext, c.create);
router.get("/my", requireRole("student"), studentContext, c.getMy);

// ── HOD dashboard ────────────────────────────────────────────────────────────
router.get("/department", requireRole("hod"), facultyContext, c.getDepartment);

// ── Student dynamic paths (specific before bare "/:id") ──────────────────────
router.patch("/:id/link-achievement", requireRole("student"), studentContext, c.linkAchievement);
router.get("/:id",    requireRole("student"), studentContext, c.getMyById);
router.patch("/:id",  requireRole("student"), studentContext, c.update);
router.delete("/:id", requireRole("student"), studentContext, c.remove);

module.exports = router;