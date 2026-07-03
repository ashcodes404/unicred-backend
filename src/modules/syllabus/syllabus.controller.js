// =============================================================================
// SYLLABUS CONTROLLER  (src/modules/syllabus/syllabus.controller.js)
// =============================================================================

const asyncHandler = require("../../utils/asyncHandler");
const service = require("./syllabus.service");
const { success } = require("../../utils/apiResponse");

/**
 * GET /api/syllabus
 * HOD / faculty / student — the syllabus files for their own department.
 */
const list = asyncHandler(async (req, res) => {
  const files = await service.listForUser(req.user);
  return success(res, 200, "Syllabus fetched.", files);
});

/**
 * POST /api/syllabus   (HOD)
 * Body: { subjectId, fileUrl, title? }. departmentId comes from facultyContext.
 */
const create = asyncHandler(async (req, res) => {
  const file = await service.createSyllabusFile(
    req.user.schoolId,
    req.faculty.departmentId,
    req.body,
    req.user.userId,
  );
  return success(res, 201, "Syllabus file uploaded.", file);
});

/**
 * PATCH /api/syllabus/:id   (HOD)
 * Body: { fileUrl?, title? } — replace the file and/or rename it.
 */
const update = asyncHandler(async (req, res) => {
  const file = await service.updateSyllabusFile(
    req.params.id,
    req.user.schoolId,
    req.faculty.departmentId,
    req.body,
    req.user.userId,
  );
  return success(res, 200, "Syllabus file updated.", file);
});

/**
 * DELETE /api/syllabus/:id   (HOD)
 */
const remove = asyncHandler(async (req, res) => {
  const result = await service.deleteSyllabusFile(
    req.params.id,
    req.user.schoolId,
    req.faculty.departmentId,
  );
  return success(res, 200, result.message, null);
});

module.exports = { list, create, update, remove };
