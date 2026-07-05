// =============================================================================
// ANNOUNCEMENT ROUTES  (mounted at /api/announcements)
// =============================================================================
//
//   GET    /api/announcements       admin/hod/faculty/student — own visible list
//                                   (sent + received for the first three roles,
//                                   received-only for students)
//   GET    /api/announcements/:id   admin/hod/faculty/student — one announcement,
//                                   only if sender or recipient
//   POST   /api/announcements       admin/hod/faculty — create (audience is
//                                   derived server-side from the sender's role,
//                                   see announcement.service.js's resolveAudience)
//
// Every route requires a valid token + tenant context (schoolId), same as
// every other module. Only the create route needs departmentId — resolved
// via facultyContext for hod/faculty senders (admins have no Faculty row at
// all, so that middleware is skipped for them — see attachFacultyContextIfNeeded below).
// =============================================================================

const express = require("express");
const router = express.Router();

const verifyToken = require("../../middleware/auth.middleware");
const attachTenant = require("../../middleware/tenant.middleware");
const requireRole = require("../../middleware/role.middleware");
const { facultyContext } = require("../../middleware/facultyContext.middleware");
const { announcementCreateRateLimiter } = require("../../middleware/rateLimit.middleware");

const controller = require("./announcement.controller");

router.use(verifyToken, attachTenant);

/**
 * WHAT: Runs facultyContext (which looks up req.faculty = {id, departmentId})
 *       for hod/faculty senders only, and skips it entirely for admins.
 * WHY: facultyContext.middleware.js 404s if no Faculty row exists for the
 *      logged-in user — true for every admin, since admins never have one.
 *      requireRole("admin","hod","faculty") below already guarantees req.user.role
 *      is one of these three, so checking for "admin" here is enough to tell
 *      the other two apart.
 */
function attachFacultyContextIfNeeded(req, res, next) {
  if (req.user.role === "admin") return next();
  return facultyContext(req, res, next);
}

// View — any authenticated role (service scopes the results per-user).
router.get("/", requireRole("admin", "hod", "faculty", "student"), controller.list);
router.get("/:id", requireRole("admin", "hod", "faculty", "student"), controller.getById);

// Create — admin (school-wide), hod (department-wide), faculty (their current students).
// Rate-limited: this fans out to potentially thousands of recipients per
// call, a much larger blast radius than a typical single-row create — see
// rateLimit.middleware.js's announcementCreateRateLimiter for the full reasoning.
router.post(
  "/",
  requireRole("admin", "hod", "faculty"),
  announcementCreateRateLimiter,
  attachFacultyContextIfNeeded,
  controller.create
);

module.exports = router;
