// =============================================================================
// STUDENT SESSION REGISTRATION CONTROLLER
// =============================================================================

const asyncHandler = require("../../utils/asyncHandler");
const service      = require("./student-registration.service");
const { success }  = require("../../utils/apiResponse");

/**
 * POST /api/students/register-session
 * Register a single student into a session. HOD only.
 */
const registerStudent = asyncHandler(async (req, res) => {
  const registration = await service.registerStudent(
    req.user.schoolId,
    req.body
  );

  return success(res,  201 , registration);
});

/**
 * POST /api/students/register-session/bulk
 * Register multiple students at once. HOD only.
 * Body: { sessionId, semesterNumber, batchYear, studentIds: [1,2,3] }
 */
const bulkRegisterStudents = asyncHandler(async (req, res) => {
  const result = await service.bulkRegisterStudents(
    req.user.schoolId,
    req.body
  );

  return success(res, 201 , result);
});

/**
 * GET /api/students/my-session
 * Student views their own current session. Student only.
 */
const getMySession = asyncHandler(async (req, res) => {
  const session = await service.getMySession(
    req.user.userId,
    req.user.schoolId
  );

  return success(res, 200, "Session fetched successfully", session);
});

/**
 * GET /api/students/session/:sessionId
 * HOD views all students registered in a session.
 * Optional: ?semesterNumber=3&batchYear=2022
 */
const getStudentsInSession = asyncHandler(async (req, res) => {
  const students = await service.getStudentsInSession(
    req.user.schoolId,
    req.params.sessionId,
    req.query
  );

  return success(res, 200, "Students fetched successfully", students);
});

/**
 * PATCH /api/students/registration/:id/detain
 * HOD marks a student's registration as "detained".
 * Detained students are skipped during automatic semester promotion.
 */
const detainStudent = asyncHandler(async (req, res) => {
  const result = await service.detainStudent(
    req.user.schoolId,
    req.params.id
  );

  return success(res, 200, result);
});

/**
 * PATCH /api/students/registration/:id/undetain
 * HOD removes a student's detention, flipping them back to "active".
 */
const undetainStudent = asyncHandler(async (req, res) => {
  const result = await service.undetainStudent(
    req.user.schoolId,
    req.params.id
  );

  return success(res, 200, result);
});

module.exports = {
  registerStudent,
  bulkRegisterStudents,
  getMySession,
  getStudentsInSession,
  detainStudent,
  undetainStudent,
};
