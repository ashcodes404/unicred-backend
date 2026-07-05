// src/modules/grading/grading.service.js

const AppError = require("../../utils/AppError");
const repo = require("./grading.repository");
const { cached, invalidate } = require("../../utils/cache");
const { notifyMany } = require("../../utils/notify");
const NOTIFICATION_TYPES = require("../../constants/notificationTypes");

const GRADING_METHODS = ["absolute", "relative"];

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

/**
 * getGradingMethod — the school's current grading method, for the
 * Grading System page to show ("Absolute" / "Relative") and to decide
 * which toggle option to offer.
 */
async function getGradingMethod(schoolId) {
  const method = await repo.getGradingMethod(schoolId);
  if (!method) throw new AppError(404, "School not found");
  return { gradingMethod: method };
}

/**
 * updateGradingMethod — admin switches the school between absolute and
 * relative grading.
 *
 * WHY `acknowledged` IS REQUIRED AND CHECKED HERE (NOT JUST IN THE UI):
 * The frontend shows a warning + a "I understand" checkbox before this
 * can be submitted — but a backend endpoint must never trust that the
 * frontend actually enforced that. Re-checking `acknowledged === true`
 * here means a raw API call (curl, Postman, a compromised/buggy frontend
 * build) can't silently skip the warning.
 *
 * WHY THIS NEVER TOUCHES PAST RESULTS:
 * This function only writes to the School row. Every SubjectMark and
 * CgpaRecord already in the database was computed at submit/publish time
 * and stored with its grade already baked in — nothing here re-opens or
 * recomputes them. The new method only takes effect the next time
 * submitMarks() runs (see results.service.js), which reads the CURRENT
 * value of School.gradingMethod fresh on every call.
 *
 * @param {number} schoolId
 * @param {number} adminUserId - excluded from the "everyone notified" list (they already know — they made the change)
 * @param {string} newMethod - "absolute" | "relative"
 * @param {boolean} acknowledged - must be true (the UI's required warning checkbox)
 */
async function updateGradingMethod(schoolId, adminUserId, newMethod, acknowledged) {
  if (!GRADING_METHODS.includes(newMethod)) {
    throw new AppError(400, `gradingMethod must be one of: ${GRADING_METHODS.join(", ")}`);
  }
  if (acknowledged !== true) {
    throw new AppError(400, "You must acknowledge the warning before changing the grading method.");
  }

  const currentMethod = await repo.getGradingMethod(schoolId);
  if (!currentMethod) throw new AppError(404, "School not found");
  if (currentMethod === newMethod) {
    throw new AppError(400, `Grading method is already set to "${newMethod}".`);
  }

  const updated = await repo.updateGradingMethod(schoolId, newMethod);

  // Notify every OTHER user in the school — admin/HOD/faculty/student
  // alike — since this changes how everyone's future results are graded.
  // Wrapped in try/catch so a notification failure can never fail the
  // actual setting change (same defensive pattern used everywhere else
  // this app fans out notifications, e.g. announcement.service.js).
  try {
    const allUserIds = await repo.findAllUserIdsInSchool(schoolId);
    const recipientIds = allUserIds.filter((id) => id !== adminUserId);
    const message =
      newMethod === "relative"
        ? "Your school has switched to RELATIVE grading (grading on a curve). This only applies to marks submitted from now on — past results are unchanged."
        : "Your school has switched back to ABSOLUTE grading (fixed marks bands). This only applies to marks submitted from now on — past results are unchanged.";
    await notifyMany(recipientIds, NOTIFICATION_TYPES.GRADING_METHOD_CHANGED, message, null);
  } catch (err) {
    console.error(`[grading] failed to notify school ${schoolId} of grading method change:`, err);
  }

  return { gradingMethod: updated.gradingMethod };
}

module.exports = {
  listGradingSystems,
  getActiveSystem,
  createGradingSystem,
  updateGradingSystem,
  activateGradingSystem,
  getGradingMethod,
  updateGradingMethod,
};
