// =============================================================================
// SCHEDULE EXCEPTIONS CONTROLLER
// (src/modules/schedule-exceptions/schedule-exceptions.controller.js)
// =============================================================================
//
// Thin layer between HTTP and the service. It reads what it needs off `req`,
// builds a small `ctx` object describing WHO is acting (role, school, dept),
// calls the service, and returns the standard success response.
//
// asyncHandler wraps each function so thrown errors go to the error middleware
// automatically (no repeated try/catch).
//
// =============================================================================

const asyncHandler = require("../../utils/asyncHandler");
const service      = require("./schedule-exceptions.service");
const { success }  = require("../../utils/apiResponse");

/**
 * buildContext — assembles the "who is acting" object used by the service.
 *
 * hodDepartmentId is only present when facultyContext middleware ran (HOD
 * routes). For admin it is null, which the service reads as "school-wide".
 *
 * `req.faculty?.departmentId` uses optional chaining (`?.`) so it safely returns
 * undefined when req.faculty is missing, and `?? null` turns that into null.
 *
 * @param {Object} req
 * @returns {{schoolId:number, role:string, userId:number, hodDepartmentId:number|null}}
 */
function buildContext(req) {
  return {
    schoolId: req.user.schoolId,
    role: req.user.role,
    userId: req.user.userId,
    hodDepartmentId: req.faculty?.departmentId ?? null,
  };
}

/**
 * POST /api/schedule-exceptions
 * Admin (school-wide) or HOD (own dept) declares a holiday or half-day.
 */
const declareException = asyncHandler(async (req, res) => {
  const exception = await service.declareException(buildContext(req), req.body);
  return success(res, 201, "Schedule exception declared.", exception);
});

/**
 * GET /api/schedule-exceptions?sessionId=&from=&to=&includeRevoked=
 * Lists exceptions the caller may see (admin: all; HOD: school-wide + own dept).
 */
const listExceptions = asyncHandler(async (req, res) => {
  const exceptions = await service.listExceptions(buildContext(req), req.query);
  return success(res, 200, "Schedule exceptions fetched.", exceptions);
});

/**
 * GET /api/schedule-exceptions/:id
 * Fetch a single exception (school-scoped).
 */
const getExceptionById = asyncHandler(async (req, res) => {
  const exception = await service.getExceptionById(
    req.params.id,
    buildContext(req),
  );
  return success(res, 200, "Schedule exception fetched.", exception);
});

/**
 * PATCH /api/schedule-exceptions/:id/revoke
 * Soft-cancel an exception (admin: any; HOD: own dept only).
 */
const revokeException = asyncHandler(async (req, res) => {
  const exception = await service.revokeException(
    buildContext(req),
    req.params.id,
  );
  return success(res, 200, "Schedule exception revoked.", exception);
});

module.exports = {
  declareException,
  listExceptions,
  getExceptionById,
  revokeException,
};
