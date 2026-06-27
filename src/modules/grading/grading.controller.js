// src/modules/grading/grading.controller.js

const asyncHandler = require("../../utils/asyncHandler");
const { success } = require("../../utils/apiResponse");
const service = require("./grading.service");

/**
 * GET /api/grading-systems
 * Admin views all grading systems for their school (custom + global default).
 */
const list = asyncHandler(async (req, res) => {
  const data = await service.listGradingSystems(req.user.schoolId);
  success(res, 200, "Grading systems fetched", data);
});

/**
 * POST /api/grading-systems
 * Admin creates a new custom grading system.
 * This immediately becomes the active system for the school.
 *
 * Body: { name, rules: [{ grade, gradePoint, minMarksPercent, maxMarksPercent }] }
 */
const create = asyncHandler(async (req, res) => {
  const { name, rules } = req.body;
  if (!name || !rules) {
    return res.status(400).json({ success: false, message: "name and rules are required" });
  }
  const data = await service.createGradingSystem(req.user.schoolId, name, rules);
  success(res, 201, "Grading system created and activated. Applies to future publications only.", data);
});

/**
 * PATCH /api/grading-systems/:id
 * Admin updates name and/or rules of an existing system.
 * Does NOT affect already-published results.
 *
 * Body: { name?, rules? }
 */
const update = asyncHandler(async (req, res) => {
  const { name, rules } = req.body;
  const data = await service.updateGradingSystem(
    Number(req.params.id), req.user.schoolId, name, rules
  );
  success(res, 200, "Grading system updated. Previously published results are not affected.", data);
});

/**
 * PATCH /api/grading-systems/:id/activate
 * Admin switches which grading system is active for their school.
 */
const activate = asyncHandler(async (req, res) => {
  const data = await service.activateGradingSystem(Number(req.params.id), req.user.schoolId);
  success(res, 200, "Grading system activated.", data);
});

module.exports = { list, create, update, activate };
