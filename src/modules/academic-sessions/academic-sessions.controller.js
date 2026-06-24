// =============================================================================
// ACADEMIC SESSIONS CONTROLLER
// =============================================================================
//
// What does the Controller do?
// ----------------------------
// The controller is the entry point for every HTTP request.
// It is a very thin layer — it does THREE things only:
//
//   1. Reads data from the request (params, body, query, req.user)
//   2. Calls the appropriate service function
//   3. Sends the response back
//
// Controllers do NOT contain business logic.
// If you find yourself writing an "if" statement that isn't about
// reading the request or sending the response — it belongs in the service.
//
// Error handling:
//   All functions are wrapped with asyncHandler (from your utils).
//   asyncHandler catches any thrown error and passes it to next(err),
//   which your error middleware handles.
//   Controllers never need try/catch blocks.
//
// =============================================================================

const asyncHandler   = require("../../utils/asyncHandler");
const service        = require("./academic-sessions.service");
const { success }    = require("../../utils/apiResponse");


// =============================================================================
// HOD / ADMIN CONTROLLERS
// =============================================================================

/**
 * POST /api/academic-sessions
 *
 * Create a new academic session.
 * HOD or Admin only.
 *
 * req.user contains: { id, schoolId, role }
 * req.faculty contains: { id, departmentId } — attached by facultyContext middleware
 */
const createSession = asyncHandler(async (req, res) => {
  const session = await service.createSession(
    req.user.schoolId,       // School isolation from JWT
    req.faculty.departmentId, // HOD's department from facultyContext middleware
    req.user.userId,             // Who created it
    req.body
  );

  return success(res, 201 , session);
});

/**
 * GET /api/academic-sessions
 *
 * List all sessions for the HOD's department.
 * Optional query param: ?status=active|upcoming|completed|archived
 */
const getAllSessions = asyncHandler(async (req, res) => {
  const sessions = await service.getAllSessions(
    req.user.schoolId,
    req.faculty.departmentId,
    req.query.status || null
  );

  return success(res, 200 , sessions);
});

/**
 * GET /api/academic-sessions/:id
 *
 * Get a single session.
 * HOD sees their department's session.
 */
const getSessionById = asyncHandler(async (req, res) => {
  const session = await service.getSessionById(
    req.params.id,
    req.user.schoolId,
    req.faculty.departmentId
  );

  return success(res, 200 , session);
});

/**
 * PATCH /api/academic-sessions/:id
 *
 * Update session metadata (name, dates).
 * HOD only.
 */
const updateSession = asyncHandler(async (req, res) => {
  const session = await service.updateSession(
    req.params.id,
    req.user.schoolId,
    req.faculty.departmentId,
    req.body
  );

  return success(res, 200 , session);
});

/**
 * PATCH /api/academic-sessions/:id/status
 *
 * Transition session lifecycle status.
 * HOD only.
 *
 * Body: { status: "active" | "completed" | "archived" }
 */
const updateSessionStatus = asyncHandler(async (req, res) => {
  const session = await service.updateSessionStatus(
    req.params.id,
    req.user.schoolId,
    req.faculty.departmentId,
    req.body.status
  );

  return success(res, 200 , session);
});

// =============================================================================
// SHARED CONTROLLER (all roles)
// =============================================================================

/**
 * GET /api/academic-sessions/:id/view
 *
 * Any authenticated user can fetch a session by ID.
 * Used by faculty and students who need session details
 * but don't own a department.
 */
const getSessionForAnyRole = asyncHandler(async (req, res) => {
  const session = await service.getSessionByIdForAnyRole(
    req.params.id,
    req.user.schoolId
  );

  return success(res, 200 , session);
});

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  createSession,
  getAllSessions,
  getSessionById,
  updateSession,
  updateSessionStatus,
  getSessionForAnyRole,
};
