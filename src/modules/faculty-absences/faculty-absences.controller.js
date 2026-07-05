// =============================================================================
// FACULTY ABSENCES CONTROLLER
// (src/modules/faculty-absences/faculty-absences.controller.js)
// =============================================================================
//
// Thin layer between HTTP and the service. Each handler pulls what it needs off
// `req`, calls the service, and returns the standard success response.
// asyncHandler forwards any thrown error to the error middleware.
//
// Context sources:
//   req.faculty.id / req.faculty.departmentId  ← facultyContext middleware
//   req.user.userId / req.user.schoolId         ← auth middleware
//
// =============================================================================

const asyncHandler = require("../../utils/asyncHandler");
const service      = require("./faculty-absences.service");
const { success }  = require("../../utils/apiResponse");

// -----------------------------------------------------------------------------
// FACULTY
// -----------------------------------------------------------------------------

/**
 * POST /api/faculty-absences
 * Faculty files a leave request for a date range.
 */
const applyForAbsence = asyncHandler(async (req, res) => {
  const ctx = {
    schoolId: req.user.schoolId,
    facultyId: req.faculty.id,
    departmentId: req.faculty.departmentId,
  };
  const absence = await service.applyForAbsence(ctx, req.body);
  return success(res, 201, "Leave request submitted. HOD has been notified.", absence);
});

/**
 * GET /api/faculty-absences/my
 * Faculty views their own leave history.
 */
const getMyAbsences = asyncHandler(async (req, res) => {
  const absences = await service.getMyAbsences(req.faculty.id, req.user.schoolId);
  return success(res, 200, "Your leave requests.", absences);
});

// -----------------------------------------------------------------------------
// HOD
// -----------------------------------------------------------------------------

/**
 * GET /api/faculty-absences/department
 * HOD lists pending requests from their own department.
 */
const getDepartmentPending = asyncHandler(async (req, res) => {
  const absences = await service.getDepartmentPending(
    req.user.schoolId,
    req.faculty.departmentId,
  );
  return success(res, 200, "Pending leave requests.", absences);
});

/**
 * PATCH /api/faculty-absences/:id/approve
 * HOD approves; the system generates one substitution row per affected class.
 */
const approveAbsence = asyncHandler(async (req, res) => {
  const ctx = {
    schoolId: req.user.schoolId,
    hodUserId: req.user.userId,
    hodDepartmentId: req.faculty.departmentId,
  };
  const absence = await service.approveAbsence(ctx, req.params.id);
  return success(res, 200, "Leave approved.", absence);
});

/**
 * PATCH /api/faculty-absences/:id/reject
 * HOD rejects with a required comment.
 */
const rejectAbsence = asyncHandler(async (req, res) => {
  const ctx = {
    schoolId: req.user.schoolId,
    hodUserId: req.user.userId,
    hodDepartmentId: req.faculty.departmentId,
  };
  const absence = await service.rejectAbsence(ctx, req.params.id, req.body.comment);
  return success(res, 200, "Leave rejected.", absence);
});

/**
 * GET /api/faculty-absences/:id/substitutions
 * HOD views the affected classes for an approved absence.
 */
const getSubstitutions = asyncHandler(async (req, res) => {
  const subs = await service.getSubstitutions(
    req.params.id,
    req.user.schoolId,
    req.faculty.departmentId,
  );
  return success(res, 200, "Affected classes.", subs);
});

/**
 * PATCH /api/faculty-absences/substitutions/:subId
 * HOD sets or clears the substitute for one affected class.
 */
const assignSubstitute = asyncHandler(async (req, res) => {
  const ctx = {
    schoolId: req.user.schoolId,
    hodDepartmentId: req.faculty.departmentId,
  };
  const absence = await service.assignSubstitute(ctx, req.params.subId, req.body);
  return success(res, 200, "Substitution updated.", absence);
});

module.exports = {
  applyForAbsence,
  getMyAbsences,
  getDepartmentPending,
  approveAbsence,
  rejectAbsence,
  getSubstitutions,
  assignSubstitute,
};
