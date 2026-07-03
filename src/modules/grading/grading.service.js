// src/modules/grading/grading.service.js

const AppError = require("../../utils/AppError");
const repo = require("./grading.repository");
const { cached, invalidate } = require("../../utils/cache");

/**
 * Validates that grade rules are complete and correct:
 * - At least 2 rules
 * - One rule with gradePoint = 0 (the F/fail rule)
 * - All percentages between 0 and 100
 * - min <= max on each rule
 * - Rules cover 0% to 100% with no gaps
 */
function validateRules(rules) {
  if (!rules || rules.length < 2) {
    throw new AppError(400, "At least 2 grade rules are required (including a fail rule)");
  }

  if (!rules.some((r) => r.gradePoint === 0)) {
    throw new AppError(400, "Must include a fail rule with gradePoint = 0 (e.g. grade F)");
  }

  for (const r of rules) {
    if (r.gradePoint < 0) throw new AppError(400, "gradePoint cannot be negative");
    if (r.minMarksPercent > r.maxMarksPercent) {
      throw new AppError(400, `Rule "${r.grade}": minMarksPercent cannot exceed maxMarksPercent`);
    }
    if (r.minMarksPercent < 0 || r.maxMarksPercent > 100) {
      throw new AppError(400, `Rule "${r.grade}": percentages must be between 0 and 100`);
    }
  }

  // Sort by min to check for gaps
  const sorted = [...rules].sort((a, b) => a.minMarksPercent - b.minMarksPercent);

  if (sorted[0].minMarksPercent !== 0) {
    throw new AppError(400, "Rules must start from 0%");
  }
  if (sorted[sorted.length - 1].maxMarksPercent !== 100) {
    throw new AppError(400, "Rules must reach 100%");
  }

  // Check no gap between consecutive rules (allow tiny float gap <= 0.02)
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i + 1].minMarksPercent - sorted[i].maxMarksPercent;
    if (gap > 0.02) {
      throw new AppError(
        400,
        `Gap in grade rules between ${sorted[i].maxMarksPercent}% and ${sorted[i + 1].minMarksPercent}%`
      );
    }
  }
}

async function listGradingSystems(schoolId) {
  return cached(
    `grd:${schoolId}:list`,
    null,
    () => repo.listBySchool(schoolId),
    `grd:${schoolId}`
  );
}

async function getActiveSystem(schoolId) {
  const system = await cached(
    `grd:${schoolId}:active`,
    null,
    () => repo.getActiveSystemForSchool(schoolId),
    `grd:${schoolId}`
  );
  if (!system) throw new AppError(500, "No grading system found. Run seed-grading.js first.");
  return system;
}

async function createGradingSystem(schoolId, name, rules) {
  validateRules(rules);
  const system = await repo.create(schoolId, name, rules);
  await invalidate(`grd:${schoolId}`);
  return system;
}

async function updateGradingSystem(id, schoolId, name, rules) {
  if (rules) validateRules(rules);
  const updated = await repo.update(id, schoolId, name, rules);
  if (!updated) throw new AppError(404, "Grading system not found or access denied");
  await invalidate(`grd:${schoolId}`);
  return updated;
}

async function activateGradingSystem(id, schoolId) {
  const system = await repo.findById(id, schoolId);
  if (!system) throw new AppError(404, "Grading system not found or access denied");
  const activated = await repo.activate(id, schoolId);
  await invalidate(`grd:${schoolId}`);
  return activated;
}

module.exports = {
  listGradingSystems,
  getActiveSystem,
  createGradingSystem,
  updateGradingSystem,
  activateGradingSystem,
};
