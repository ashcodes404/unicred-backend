// =============================================================================
// TIMETABLES CONTROLLER  (src/modules/timetables/timetables.controller.js)
// =============================================================================
//
// A controller is the thin layer between the HTTP request and the service.
// Its only jobs: read what it needs off `req`, call the matching service
// function, and send the result back with `success(...)`. No business rules
// live here — those are in the service.
//
// Every handler is wrapped in `asyncHandler`, a helper that catches errors from
// async code and forwards them to the global error middleware, so we don't have
// to write try/catch in each function.
//
// `success(res, statusCode, message, data)` is the project's standard response
// helper — it always returns { success: true, message, data }.
//
// =============================================================================

const asyncHandler = require("../../utils/asyncHandler");
const service      = require("./timetables.service");
const { success }  = require("../../utils/apiResponse");

// -----------------------------------------------------------------------------
// HOD — timetable CRUD
// -----------------------------------------------------------------------------

/**
 * POST /api/timetables
 * HOD creates a new (empty) draft timetable.
 * departmentId comes from req.faculty (set by facultyContext middleware),
 * never from the body, so a HOD can only build for their own department.
 */
const createTimetable = asyncHandler(async (req, res) => {
  const timetable = await service.createTimetable(
    req.user.schoolId,
    req.faculty.departmentId,
    req.body,
  );
  return success(res, 201, "Timetable created.", timetable);
});

/**
 * GET /api/timetables?sessionId=5
 * HOD lists their department's timetables.
 */
const getDepartmentTimetables = asyncHandler(async (req, res) => {
  const timetables = await service.getDepartmentTimetables(
    req.user.schoolId,
    req.faculty.departmentId,
    req.query,
  );
  return success(res, 200, "Timetables fetched.", timetables);
});

/**
 * GET /api/timetables/:id
 * View a single timetable with its slots — scoped to the caller's own
 * department (admins may view any). The service enforces the rule.
 */
const getTimetableById = asyncHandler(async (req, res) => {
  const timetable = await service.getTimetableById(req.params.id, req.user);
  return success(res, 200, "Timetable fetched.", timetable);
});

// -----------------------------------------------------------------------------
// DEPARTMENT TIMETABLE DOCUMENTS (uploaded PDFs/images, per audience)
// -----------------------------------------------------------------------------

/**
 * GET /api/timetables/documents[?audience=faculty|student]
 * HOD, faculty, or student lists THEIR OWN department's timetable documents.
 * Faculty always get `faculty` documents and students `student` documents;
 * HODs may filter by audience or see both.
 */
const listTimetableDocuments = asyncHandler(async (req, res) => {
  const docs = await service.listDepartmentTimetableDocuments(
    req.user,
    req.query.audience,
  );
  return success(res, 200, "Timetable documents fetched.", docs);
});

/**
 * POST /api/timetables/documents
 * HOD adds a new timetable document for their department.
 * departmentId comes from req.faculty (facultyContext), never the body.
 * Body: { fileUrl, audience: "faculty"|"student", title? }
 */
const addTimetableDocument = asyncHandler(async (req, res) => {
  const doc = await service.addDepartmentTimetableDocument(
    req.user.schoolId,
    req.faculty.departmentId,
    req.body,
    req.user.userId,
  );
  return success(res, 201, "Timetable document added.", doc);
});

/**
 * PATCH /api/timetables/documents/:id
 * HOD edits one of their department's documents (replace file / retitle).
 * Body: { fileUrl?, title? }
 */
const updateTimetableDocument = asyncHandler(async (req, res) => {
  const doc = await service.updateDepartmentTimetableDocument(
    Number(req.params.id),
    req.user.schoolId,
    req.faculty.departmentId,
    req.body,
    req.user.userId,
  );
  return success(res, 200, "Timetable document updated.", doc);
});

/**
 * DELETE /api/timetables/documents/:id
 * HOD deletes one of their department's documents.
 */
const deleteTimetableDocument = asyncHandler(async (req, res) => {
  const result = await service.deleteDepartmentTimetableDocument(
    Number(req.params.id),
    req.user.schoolId,
    req.faculty.departmentId,
  );
  return success(res, 200, "Timetable document deleted.", result);
});

/**
 * PATCH /api/timetables/:id
 * HOD updates a timetable's own fields (draft/returned only).
 */
const updateTimetable = asyncHandler(async (req, res) => {
  const timetable = await service.updateTimetable(
    req.params.id,
    req.user.schoolId,
    req.body,
  );
  return success(res, 200, "Timetable updated.", timetable);
});

// -----------------------------------------------------------------------------
// HOD — slots
// -----------------------------------------------------------------------------

/**
 * POST /api/timetables/:id/slots
 * HOD adds a class block to a timetable.
 */
const addSlot = asyncHandler(async (req, res) => {
  const slot = await service.addSlot(
    req.params.id,
    req.user.schoolId,
    req.body,
  );
  return success(res, 201, "Slot added.", slot);
});

/**
 * PATCH /api/timetables/:id/slots/:slotId
 * HOD edits a slot.
 */
const updateSlot = asyncHandler(async (req, res) => {
  const slot = await service.updateSlot(
    req.params.id,
    req.params.slotId,
    req.user.schoolId,
    req.body,
  );
  return success(res, 200, "Slot updated.", slot);
});

/**
 * DELETE /api/timetables/:id/slots/:slotId
 * HOD removes a slot.
 */
const deleteSlot = asyncHandler(async (req, res) => {
  const result = await service.deleteSlot(
    req.params.id,
    req.params.slotId,
    req.user.schoolId,
  );
  return success(res, 200, result.message, null);
});

// -----------------------------------------------------------------------------
// HOD — submit / resubmit
// -----------------------------------------------------------------------------

/**
 * PATCH /api/timetables/:id/submit
 * HOD submits a draft to admin.
 */
const submitTimetable = asyncHandler(async (req, res) => {
  const timetable = await service.submitTimetable(
    req.params.id,
    req.user.schoolId,
  );
  return success(res, 200, "Timetable submitted for approval.", timetable);
});

/**
 * PATCH /api/timetables/:id/resubmit
 * HOD resubmits a returned timetable after corrections.
 */
const resubmitTimetable = asyncHandler(async (req, res) => {
  const timetable = await service.resubmitTimetable(
    req.params.id,
    req.user.schoolId,
  );
  return success(res, 200, "Timetable resubmitted for approval.", timetable);
});

// -----------------------------------------------------------------------------
// ADMIN — review workflow
// -----------------------------------------------------------------------------

/**
 * GET /api/admin/timetables
 * Admin lists all submitted timetables across the school.
 */
const getSubmittedTimetables = asyncHandler(async (req, res) => {
  const timetables = await service.getSubmittedTimetables(req.user.schoolId);
  return success(res, 200, "Submitted timetables fetched.", timetables);
});

/**
 * PATCH /api/admin/timetables/:id/approve
 * Admin approves a submitted timetable.
 */
const approveTimetable = asyncHandler(async (req, res) => {
  const timetable = await service.approveTimetable(
    req.params.id,
    req.user.schoolId,
    req.user.userId, // the approving admin
  );
  return success(res, 200, "Timetable approved.", timetable);
});

/**
 * PATCH /api/admin/timetables/:id/return
 * Admin returns a timetable with a required comment.
 */
const returnTimetable = asyncHandler(async (req, res) => {
  const timetable = await service.returnTimetable(
    req.params.id,
    req.user.schoolId,
    req.user.userId,
    req.body.comment,
  );
  return success(res, 200, "Timetable returned to HOD.", timetable);
});

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  createTimetable,
  getDepartmentTimetables,
  getTimetableById,
  listTimetableDocuments,
  addTimetableDocument,
  updateTimetableDocument,
  deleteTimetableDocument,
  updateTimetable,
  addSlot,
  updateSlot,
  deleteSlot,
  submitTimetable,
  resubmitTimetable,
  getSubmittedTimetables,
  approveTimetable,
  returnTimetable,
};
