// =============================================================================
// FACULTY ASSIGNMENTS CONTROLLER
// =============================================================================

const asyncHandler = require("../../utils/asyncHandler");
const service      = require("./faculty-assignments.service");
const { success }  = require("../../utils/apiResponse");

/**
 * POST /api/faculty/assignments
 * HOD assigns a faculty member to a subject.
 */
const createAssignment = asyncHandler(async (req, res) => {
  const assignment = await service.createAssignment(
    req.user.schoolId,
    req.faculty.departmentId, // HOD's department (from facultyContext)
    req.user.userId,          // HOD's userId — stored as assignedByHodId
    req.body
  );

  return success(res, 201, assignment);
});

/**
 * GET /api/faculty/assignments?sessionId=5
 * HOD sees all assignments for their department in a session.
 */
const getAllAssignments = asyncHandler(async (req, res) => {
  const assignments = await service.getAllAssignments(
    req.user.schoolId,
    req.faculty.departmentId,
    req.query
  );

  return success(res, 200 , assignments);
});

/**
 * GET /api/faculty/assignments/my
 * Faculty sees their own assignments.
 * Optional: ?sessionId=5 to filter by session.
 */
const getMyAssignments = asyncHandler(async (req, res) => {
  const assignments = await service.getMyAssignments(
    req.user.userId,
    req.user.schoolId,
    req.query
  );

  return success(res, 200 , assignments);
});

/**
 * PATCH /api/faculty/assignments/:id
 * HOD modifies an assignment.
 */
const updateAssignment = asyncHandler(async (req, res) => {
  const assignment = await service.updateAssignment(
    req.params.id,
    req.user.schoolId,
    req.body
  );

  return success(res, 200 , assignment);
});

/**
 * DELETE /api/faculty/assignments/:id
 * HOD removes an assignment.
 */
const deleteAssignment = asyncHandler(async (req, res) => {
  const result = await service.deleteAssignment(
    req.params.id,
    req.user.schoolId
  );

  return success(res, 200 , result);
});

/**
 * GET /api/faculty-assignments/student/subject/:subjectId
 * Student views which faculty teaches a given subject in their own active session.
 * The session/batch/semester scope is derived server-side from the student's
 * registration — the student cannot supply or tamper with those values.
 */
const getFacultyForStudentSubject = asyncHandler(async (req, res) => {
  const result = await service.getFacultyForStudentSubject(
    req.user.userId,
    req.user.schoolId,
    req.params.subjectId
  );

  return success(res, 200, "Faculty fetched successfully", result);
});

module.exports = {
  createAssignment,
  getAllAssignments,
  getMyAssignments,
  updateAssignment,
  deleteAssignment,
  getFacultyForStudentSubject,
};
