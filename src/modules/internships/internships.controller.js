// =============================================================================
// INTERNSHIPS CONTROLLER
// =============================================================================
//
// Thin layer: pull data off the request, call the service, return success().
//
//   req.user    = { userId, role, schoolId }
//   req.student = full Student row  (studentContext)
//   req.faculty = { id, departmentId }  (facultyContext)
// =============================================================================

const asyncHandler = require("../../utils/asyncHandler");
const service      = require("./internships.service");
const { success }  = require("../../utils/apiResponse");

// ── Student ──────────────────────────────────────────────────────────────────

const create = asyncHandler(async (req, res) => {
  const data = await service.createInternship(req.student, req.body);
  return success(res, 201, "Internship added.", data);
});

const getMy = asyncHandler(async (req, res) => {
  const data = await service.getMyInternships(req.student.id, req.query);
  return success(res, 200, "Internships fetched.", data);
});

const getMyById = asyncHandler(async (req, res) => {
  const data = await service.getMyInternshipById(req.params.id, req.student.id);
  return success(res, 200, "Internship fetched.", data);
});

const update = asyncHandler(async (req, res) => {
  const data = await service.updateInternship(req.params.id, req.student.id, req.body);
  return success(res, 200, "Internship updated.", data);
});

const remove = asyncHandler(async (req, res) => {
  const data = await service.deleteInternship(req.params.id, req.student.id);
  return success(res, 200, data.message, null);
});

const linkAchievement = asyncHandler(async (req, res) => {
  const data = await service.linkAchievement(
    req.params.id,
    req.student.id,
    req.body.achievementId
  );
  return success(res, 200, "Achievement linked to internship.", data);
});

// ── HOD dashboard ──────────────────────────────────────────────────────────────

const getDepartment = asyncHandler(async (req, res) => {
  const data = await service.getDepartmentInternships(
    req.user.schoolId,
    req.faculty.departmentId,
    req.query
  );
  return success(res, 200, "Department internships fetched.", data);
});

module.exports = {
  create,
  getMy,
  getMyById,
  update,
  remove,
  linkAchievement,
  getDepartment,
};