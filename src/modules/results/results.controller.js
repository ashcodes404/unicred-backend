// src/modules/results/results.controller.js

const asyncHandler = require("../../utils/asyncHandler");
const { success } = require("../../utils/apiResponse");
const service = require("./results.service");

// ─── HOD: Publication Management ─────────────────────────────────────────────

/**
 * POST /api/results/publications
 * HOD creates a publication. Auto-generates submission tracker rows.
 * Body: { sessionId, batchYear, semesterNumber }
 */
const createPublication = asyncHandler(async (req, res) => {
  const { sessionId, batchYear, semesterNumber } = req.body;
  if (!sessionId || !batchYear || !semesterNumber) {
    return res.status(400).json({ success: false, message: "sessionId, batchYear, semesterNumber required" });
  }
  // departmentId comes from the HOD's faculty context
  const departmentId = req.faculty.departmentId;
  const data = await service.createPublication(req.user.schoolId, sessionId, departmentId, batchYear, semesterNumber);
  success(res, 201, "Publication created. Faculty can now upload marks.", data);
});

/**
 * GET /api/results/publications
 * HOD lists all publications for their department with completion %.
 */
const listPublications = asyncHandler(async (req, res) => {
  const data = await service.getPublications(req.user.schoolId, req.faculty.departmentId);
  success(res, 200, "Publications fetched", data);
});

/**
 * GET /api/results/publications/:id
 * HOD/Faculty views one publication with submission status.
 */
const getPublication = asyncHandler(async (req, res) => {
  const data = await service.getPublication(Number(req.params.id), req.user.schoolId, req.faculty.departmentId);
  success(res, 200, "Publication fetched", data);
});

/**
 * PATCH /api/results/publications/:id/status
 * HOD moves the publication through its lifecycle.
 * Body: { status: "under_review" | "frozen" | "published" }
 */
const transitionStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!status) return res.status(400).json({ success: false, message: "status required" });
  const data = await service.transitionStatus(Number(req.params.id), req.user.schoolId, status, req.user.userId, req.faculty.departmentId);
  success(res, 200, `Status updated to "${status}"`, data);
});

// ─── HOD: Review Endpoints ────────────────────────────────────────────────────

/**
 * GET /api/results/publications/:id/summary
 * Full result table for HOD review.
 */
const getSummary = asyncHandler(async (req, res) => {
  const data = await service.getResultSummary(Number(req.params.id), req.user.schoolId, req.faculty.departmentId);
  success(res, 200, "Summary fetched", data);
});

/**
 * GET /api/results/publications/:id/pending
 * Faculty who haven't submitted yet.
 */
const getPending = asyncHandler(async (req, res) => {
  const data = await service.getPendingSubmissions(Number(req.params.id), req.user.schoolId, req.faculty.departmentId);
  success(res, 200, "Pending submissions fetched", data);
});

/**
 * GET /api/results/publications/:id/failures
 * Students who failed at least one subject.
 */
const getFailures = asyncHandler(async (req, res) => {
  const data = await service.getFailedStudents(Number(req.params.id), req.user.schoolId, req.faculty.departmentId);
  success(res, 200, "Failed students fetched", data);
});

// ─── Faculty: Mark Upload ─────────────────────────────────────────────────────

/**
 * GET /api/results/my-subjects
 * Subjects a faculty can upload marks for (draft/under_review publications only).
 */
const getMySubjects = asyncHandler(async (req, res) => {
  const data = await service.getSubmittableSubjects(req.faculty.id, req.user.schoolId);
  success(res, 200, "Subjects fetched", data);
});

/**
 * POST /api/results/submit
 * Faculty bulk uploads marks for a subject.
 * Body: { publicationId, subjectId, marks: [{ studentId, marks }] }
 */
const submitMarks = asyncHandler(async (req, res) => {
  const { publicationId, subjectId, marks } = req.body;
  if (!publicationId || !subjectId || !Array.isArray(marks)) {
    return res.status(400).json({ success: false, message: "publicationId, subjectId, and marks[] required" });
  }
  const data = await service.submitMarks(req.faculty.id, req.user.schoolId, publicationId, subjectId, marks);
  success(res, 200, data.allSubmitted ? "Marks submitted. All subjects done — HOD notified." : "Marks submitted.", data);
});

/**
 * GET /api/results/submissions/:subjectId?publicationId=X
 * Faculty views their submitted marks for a subject.
 */
const getSubmittedMarks = asyncHandler(async (req, res) => {
  const publicationId = Number(req.query.publicationId);
  if (!publicationId) return res.status(400).json({ success: false, message: "publicationId query param required" });
  const data = await service.getFacultyMarks(publicationId, Number(req.params.subjectId), req.faculty.id, req.user.schoolId);
  success(res, 200, "Marks fetched", data);
});

/**
 * PATCH /api/results/submissions/:subjectId
 * Faculty edits submitted marks (draft/under_review only).
 * Body: { publicationId, marks: [{ studentId, marks }] }
 */
const editMarks = asyncHandler(async (req, res) => {
  const { publicationId, marks } = req.body;
  const data = await service.submitMarks(req.faculty.id, req.user.schoolId, publicationId, Number(req.params.subjectId), marks);
  success(res, 200, "Marks updated.", data);
});

/**
 * POST /api/results/submit-reappear
 * Faculty uploads reappear exam marks (same flow, isReappear=true).
 * Body: { publicationId, subjectId, marks: [{ studentId, marks }] }
 */
const submitReappearMarks = asyncHandler(async (req, res) => {
  const { publicationId, subjectId, marks } = req.body;
  if (!publicationId || !subjectId || !Array.isArray(marks)) {
    return res.status(400).json({ success: false, message: "publicationId, subjectId, marks[] required" });
  }
  const data = await service.submitMarks(req.faculty.id, req.user.schoolId, publicationId, subjectId, marks, true);
  success(res, 200, "Reappear marks submitted.", data);
});

// ─── Student: Result View ─────────────────────────────────────────────────────

/**
 * GET /api/students/results
 * All published results for the logged-in student.
 */
const getStudentResults = asyncHandler(async (req, res) => {
  const data = await service.getStudentResults(req.student.id);
  success(res, 200, "Results fetched", data);
});

/**
 * GET /api/students/results/:sessionId
 * Results for one specific session.
 */
const getStudentResultsBySession = asyncHandler(async (req, res) => {
  const data = await service.getStudentResults(req.student.id, Number(req.params.sessionId));
  success(res, 200, "Results fetched", data);
});

/**
 * GET /api/students/cgpa
 * SGPA + CGPA history across all semesters.
 */
const getStudentCgpa = asyncHandler(async (req, res) => {
  const data = await service.getStudentCgpa(req.student.id);
  success(res, 200, "CGPA history fetched", data);
});

/**
 * GET /api/results/roster?publicationId=X&subjectId=Y
 * Faculty's full student roster for a subject — used to render the mark-entry
 * table, including students who haven't been marked yet.
 */
const getRoster = asyncHandler(async (req, res) => {
  const publicationId = Number(req.query.publicationId);
  const subjectId = Number(req.query.subjectId);
  if (!publicationId || !subjectId) {
    return res.status(400).json({ success: false, message: "publicationId and subjectId query params required" });
  }
  const data = await service.getRoster(req.faculty.id, req.user.schoolId, publicationId, subjectId);
  success(res, 200, "Roster fetched", data);
});

module.exports = {
  createPublication, listPublications, getPublication, transitionStatus,
  getSummary, getPending, getFailures,
  getMySubjects, submitMarks, getSubmittedMarks, editMarks, submitReappearMarks,
  getStudentResults, getStudentResultsBySession, getStudentCgpa, getRoster,
};
