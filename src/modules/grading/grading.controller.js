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

/**
 * GET /api/grading-systems/method
 * Current grading method for the school ("absolute" | "relative").
 */
const getMethod = asyncHandler(async (req, res) => {
  const data = await service.getGradingMethod(req.user.schoolId);
  success(res, 200, "Grading method fetched", data);
});

/**
 * PATCH /api/grading-systems/method
 * Admin switches the school's grading method. Only takes effect for
 * marks submitted from now on — never touches already-computed results.
 *
 * Body: { gradingMethod: "absolute" | "relative", acknowledged: true }
 * `acknowledged` must be true — it's the server-side half of the
 * frontend's required warning/T&C checkbox (see grading.service.js's
 * updateGradingMethod for why this is re-checked here, not just in the UI).
 */
const updateMethod = asyncHandler(async (req, res) => {
  const { gradingMethod, acknowledged } = req.body;
  const data = await service.updateGradingMethod(req.user.schoolId, req.user.userId, gradingMethod, acknowledged);
  success(res, 200, `Grading method changed to "${data.gradingMethod}". Applies to future results only.`, data);
});

module.exports = { list, create, update, activate, getMethod, updateMethod };
