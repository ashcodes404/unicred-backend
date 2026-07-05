// =============================================================================
// ACADEMIC SESSIONS ROUTES
// =============================================================================
//
// Middleware chain for every request:
//
//   verifyToken      → decodes JWT, attaches req.user = { id, schoolId, role }
//   attachTenant     → attaches req.schoolId (convenience alias)
//   requireRole(...) → checks req.user.role against allowed roles
//   facultyContext   → for HOD routes: fetches faculty record, attaches
//                      req.faculty = { id, departmentId }
//                      HOD is also a faculty — this gives us their departmentId
//
// Why facultyContext?
//   The HOD's JWT contains { id, schoolId, role }.
//   It does NOT contain departmentId.
//   To know which department the HOD manages, we fetch their Faculty record.
//   facultyContext does this once and attaches it to the request.
//
// Route summary:
//
//   POST   /api/academic-sessions           HOD — create session
//   GET    /api/academic-sessions           HOD — list dept sessions
//   GET    /api/academic-sessions/:id       HOD — get one session
//   PATCH  /api/academic-sessions/:id       HOD — update session
//   PATCH  /api/academic-sessions/:id/status HOD — transition status
//   GET    /api/academic-sessions/:id/view  Any auth user — view session
//
// =============================================================================

const express        = require("express");
const router         = express.Router();
const controller     = require("./academic-sessions.controller");
const verifyToken      = require("../../middleware/auth.middleware");
const  requireRole     = require("../../middleware/role.middleware");
const  attachTenant     = require("../../middleware/tenant.middleware");
const { facultyContext }  = require("../../middleware/facultyContext.middleware");

// ── Base middleware: all routes need a valid JWT and tenant ───────────────────
router.use(verifyToken, attachTenant);

// =============================================================================
// HOD ROUTES
// All require role = hod.
// facultyContext fetches the HOD's Faculty record → provides departmentId.
// =============================================================================

// Create a new academic session
router.post(
  "/",
  requireRole("hod"),
  facultyContext,
  controller.createSession
);

// List all sessions for the HOD's department
// Optional: ?status=active|upcoming|completed|archived
router.get(
  "/",
  requireRole("hod"),
  facultyContext,
  controller.getAllSessions
);

// Get a single session (HOD view — dept-scoped)
router.get(
  "/:id",
  requireRole("hod"),
  facultyContext,
  controller.getSessionById
);

// Update session metadata (name, dates)
router.patch(
  "/:id",
  requireRole("hod"),
  facultyContext,
  controller.updateSession
);

// Transition session status (upcoming→active→completed→archived)
router.patch(
  "/:id/status",
  requireRole("hod"),
  facultyContext,
  controller.updateSessionStatus
);

// =============================================================================
// SHARED ROUTES
// Any authenticated role can access these.
// =============================================================================

// Any authenticated user can view a session by ID
// (faculty need sessionId for assignments, students need it for dashboard)
router.get(
  "/:id/view",
  requireRole("student", "faculty", "hod", "admin"),
  controller.getSessionForAnyRole
);

module.exports = router;
