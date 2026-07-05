// =============================================================================
// COURSES CONTROLLER
// =============================================================================

const asyncHandler = require("../../utils/asyncHandler");
const service      = require("./courses.service");
const { success }  = require("../../utils/apiResponse");

// ── Subjects ──────────────────────────────────────────────────────────────────

const createSubject = asyncHandler(async (req, res) => {
  const subject = await service.createSubject(
    req.user.schoolId,
    req.faculty.departmentId,
    req.body
  );

  return success(res, 201, "Subject created successfully", subject);
});

const getAllSubjects = asyncHandler(async (req, res) => {
  // ?includeInactive=true shows deactivated subjects (HOD management view)
  const includeInactive = req.query.includeInactive === "true";

  const subjects = await service.getAllSubjects(
    req.user.schoolId,
    req.faculty.departmentId,
    includeInactive
  );

  return success(res, 200, "Subjects fetched successfully", subjects);
});

const getSubjectById = asyncHandler(async (req, res) => {
  const subject = await service.getSubjectById(
    req.params.id,
    req.user.schoolId,
    req.faculty.departmentId
  );

  return success(res, 200, "Subject fetched successfully", subject);
});

// Any authenticated role can view subject details
const getSubjectForAnyRole = asyncHandler(async (req, res) => {
  const subject = await service.getSubjectByIdForAnyRole(
    req.params.id,
    req.user.schoolId
  );

  return success(res, 200, "Subject fetched successfully", subject);
});

const updateSubject = asyncHandler(async (req, res) => {
  const subject = await service.updateSubject(
    req.params.id,
    req.user.schoolId,
    req.faculty.departmentId,
    req.body
  );

  return success(res, 200, "Subject updated successfully", subject);
});

const deactivateSubject = asyncHandler(async (req, res) => {
  const result = await service.deactivateSubject(
    req.params.id,
    req.user.schoolId,
    req.faculty.departmentId
  );

  return success(res, 200, "Subject deactivated successfully", result);
});

// ── Offerings ─────────────────────────────────────────────────────────────────

const createOffering = asyncHandler(async (req, res) => {
  const offering = await service.createOffering(
    req.user.schoolId,
    req.faculty.departmentId,
    req.body
  );

  return success(res, 201, "Course offering created successfully", offering);
});

const getOfferings = asyncHandler(async (req, res) => {
  // :sessionId comes from the URL: GET /courses/offerings/:sessionId
  const offerings = await service.getOfferings(
    req.user.schoolId,
    req.params.sessionId,
    req.query  // May contain ?semesterNumber=3&batchYear=2022
  );

  return success(res, 200, "Offerings fetched successfully", offerings);
});

const deleteOffering = asyncHandler(async (req, res) => {
  const result = await service.deleteOffering(
    req.params.offeringId,
    req.user.schoolId
  );

  return success(res, 200, "Offering removed successfully", result);
});

module.exports = {
  createSubject,
  getAllSubjects,
  getSubjectById,
  getSubjectForAnyRole,
  updateSubject,
  deactivateSubject,
  createOffering,
  getOfferings,
  deleteOffering,
};
