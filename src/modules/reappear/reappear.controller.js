// src/modules/reappear/reappear.controller.js

const asyncHandler = require("../../utils/asyncHandler");
const { success } = require("../../utils/apiResponse");
const service = require("./reappear.service");

// ─── Student ──────────────────────────────────────────────────────────────────

/**
 * POST /api/reappear/apply
 * Body: { subjectId, sessionId, reason }
 */
const apply = asyncHandler(async (req, res) => {
  const { subjectId, sessionId, reason } = req.body;
  if (!subjectId || !sessionId || !reason) {
    return res.status(400).json({ success: false, message: "subjectId, sessionId, reason required" });
  }
  const data = await service.applyForReappear(req.student.id, req.user.schoolId, subjectId, sessionId, reason);
  success(res, 201, "Reappear application submitted. HOD has been notified.", data);
});

/** GET /api/reappear/my-applications */
const myApplications = asyncHandler(async (req, res) => {
  const data = await service.getMyApplications(req.student.id);
  success(res, 200, "Applications fetched", data);
});

/** DELETE /api/reappear/applications/:id */
const withdraw = asyncHandler(async (req, res) => {
  await service.withdrawApplication(Number(req.params.id), req.student.id);
  success(res, 200, "Application withdrawn.");
});

// ─── HOD ──────────────────────────────────────────────────────────────────────

/**
 * GET /api/reappear/department?status=pending
 */
const deptApplications = asyncHandler(async (req, res) => {
  const data = await service.getDeptApplications(req.user.schoolId, req.faculty.departmentId, req.query.status);
  success(res, 200, "Applications fetched", data);
});

/**
 * PATCH /api/reappear/applications/:id/approve
 * Body: { comment? }
 */
const approve = asyncHandler(async (req, res) => {
  const data = await service.approveApplication(
    Number(req.params.id), req.user.schoolId, req.faculty.id, req.body.comment
  );
  success(res, 200, data.message);
});

/**
 * PATCH /api/reappear/applications/:id/reject
 * Body: { comment } — required
 */
const reject = asyncHandler(async (req, res) => {
  const data = await service.rejectApplication(
    Number(req.params.id), req.user.schoolId, req.faculty.id, req.body.comment
  );
  success(res, 200, data.message);
});

// ─── Faculty ──────────────────────────────────────────────────────────────────

/** GET /api/reappear/active-students */
const activeStudents = asyncHandler(async (req, res) => {
  const data = await service.getActiveReappearStudents(req.faculty.id, req.user.schoolId);
  success(res, 200, "Reappear students fetched", data);
});

module.exports = { apply, myApplications, withdraw, deptApplications, approve, reject, activeStudents };
