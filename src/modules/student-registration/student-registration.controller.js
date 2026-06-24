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

  return success(res, 200 , session);
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

  return success(res, 200 , students);
});

module.exports = {
  registerStudent,
  bulkRegisterStudents,
  getMySession,
  getStudentsInSession,
};
