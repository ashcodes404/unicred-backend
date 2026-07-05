// =============================================================================
// ACHIEVEMENTS CONTROLLER  (multi-faculty / Option B)
// =============================================================================
//
// Thin layer: read what's needed off the request, call the service, return the
// standard success() response.
//
//   req.user    = { userId, role, schoolId }   (auth.middleware)
//   req.student = full Student row             (studentContext.middleware)
//   req.faculty = { id, departmentId }         (facultyContext.middleware)
// =============================================================================

const asyncHandler = require("../../utils/asyncHandler");
const service      = require("./achievements.service");
const { success }  = require("../../utils/apiResponse");

// ── Student ──────────────────────────────────────────────────────────────────

const create = asyncHandler(async (req, res) => {
  const data = await service.createAchievement(req.student, req.body);
  return success(res, 201, "Achievement submitted for verification.", data);
});

const getMy = asyncHandler(async (req, res) => {
  const data = await service.getMyAchievements(req.student.id, req.query);
  return success(res, 200, "Achievements fetched.", data);
});

const getMyById = asyncHandler(async (req, res) => {
  const data = await service.getMyAchievementById(req.params.id, req.student.id);
  return success(res, 200, "Achievement fetched.", data);
});

const update = asyncHandler(async (req, res) => {
  const data = await service.updateAchievement(req.params.id, req.student.id, req.body);
  return success(res, 200, "Achievement updated.", data);
});

const remove = asyncHandler(async (req, res) => {
  const data = await service.deleteAchievement(req.params.id, req.student.id);
  return success(res, 200, data.message, null);
});

const addReviewers = asyncHandler(async (req, res) => {
  const data = await service.addReviewers(req.params.id, req.student, req.body.facultyIds);
  return success(res, 200, "Reviewers added.", data);
});

const removeReviewer = asyncHandler(async (req, res) => {
  const data = await service.removeReviewer(req.params.id, req.student.id, req.params.facultyId);
  return success(res, 200, "Reviewer removed.", data);
});

// ── Faculty ──────────────────────────────────────────────────────────────────

const getAssigned = asyncHandler(async (req, res) => {
  const data = await service.getAssignedAchievements(req.faculty.id, req.query);
  return success(res, 200, "Assigned achievements fetched.", data);
});

const getReviewDetail = asyncHandler(async (req, res) => {
  const data = await service.getReviewDetail(req.params.id, req.faculty.id);
  return success(res, 200, "Review detail fetched.", data);
});

const verify = asyncHandler(async (req, res) => {
  const data = await service.verifyAchievement(req.params.id, req.faculty.id, req.body.remark);
  return success(res, 200, data.message, data);
});

const reject = asyncHandler(async (req, res) => {
  const data = await service.rejectAchievement(req.params.id, req.faculty.id, req.body.remark);
  return success(res, 200, data.message, data);
});

// ── HOD dashboard ──────────────────────────────────────────────────────────────

const getDepartment = asyncHandler(async (req, res) => {
  const data = await service.getDepartmentAchievements(
    req.user.schoolId,
    req.faculty.departmentId,
    req.query
  );
  return success(res, 200, "Department achievements fetched.", data);
});

module.exports = {
  create,
  getMy,
  getMyById,
  update,
  remove,
  addReviewers,
  removeReviewer,
  getAssigned,
  getReviewDetail,
  verify,
  reject,
  getDepartment,
};