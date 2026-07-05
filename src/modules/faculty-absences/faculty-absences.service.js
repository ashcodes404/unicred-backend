// =============================================================================
// FACULTY ABSENCES SERVICE
// (src/modules/faculty-absences/faculty-absences.service.js)
// =============================================================================
//
// The full absence + substitution workflow:
//
//   1. Faculty files leave (a date range) → status "pending" → HOD notified.
//   2. HOD approves → the system finds every class the teacher has on those
//      days and creates ONE substitution row per class (substitute empty).
//      OR HOD rejects with a comment.
//   3. HOD fills a substitute per class. A valid substitute must be active, in
//      the same department, not the absent teacher, and free at that time.
//      Leaving it empty means that class is cancelled for the day.
//
// The weekly timetable is never edited — substitution rows layer on top of it.
//
// =============================================================================

const repo         = require("./faculty-absences.repository");
const sessionRepo  = require("../academic-sessions/academic-sessions.repository");
const prisma       = require("../../config/db");
const AppError     = require("../../utils/AppError");
const { notify }   = require("../../utils/notify");
const { timesOverlap } = require("../../utils/time");
const {
  isValidDateString,
  startOfDay,
  endOfDay,
  isStartBeforeOrSameDay,
  getIsoWeekday,
  eachDateInRange,
} = require("../../utils/date");
const NOTIFICATION_TYPES = require("../../constants/notificationTypes");

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/**
 * getHodUserId — the userId of the HOD who runs a department (to notify on
 * a new application).
 *
 * @param {number} departmentId
 * @param {number} schoolId
 * @returns {Promise<number|null>}
 */
async function getHodUserId(departmentId, schoolId) {
  const dept = await prisma.department.findFirst({
    where: { id: departmentId, schoolId },
    select: { hodUserId: true },
  });
  return dept?.hodUserId ?? null;
}

/**
 * loadAbsenceOr404 — fetch an absence or throw 404 (school-scoped).
 */
async function loadAbsenceOr404(id, schoolId) {
  const absence = await repo.findAbsenceById(id, schoolId);
  if (!absence) throw new AppError(404, "Absence request not found.");
  return absence;
}

// =============================================================================
// 1. FACULTY FILES LEAVE
// =============================================================================

/**
 * applyForAbsence — a faculty member files a leave request for a date range.
 *
 * @param {Object} ctx { schoolId, facultyId, departmentId }  (from facultyContext)
 * @param {Object} body { sessionId, startDate, endDate?, reason }
 * @returns {Promise<Object>} the created (pending) absence
 */
async function applyForAbsence(ctx, body) {
  const { schoolId, facultyId, departmentId } = ctx;
  const { sessionId, startDate, endDate, reason } = body;

  if (!sessionId || !startDate || !reason || !reason.trim()) {
    throw new AppError(400, "sessionId, startDate, and reason are required.");
  }

  // A single-day leave is allowed: missing endDate defaults to startDate.
  const rawEnd = endDate || startDate;

  if (!isValidDateString(startDate) || !isValidDateString(rawEnd)) {
    throw new AppError(400, "startDate/endDate must be valid dates (YYYY-MM-DD).");
  }
  if (!isStartBeforeOrSameDay(startDate, rawEnd)) {
    throw new AppError(400, "endDate cannot be before startDate.");
  }

  const session = await sessionRepo.findByIdForAnyRole(parseInt(sessionId), schoolId);
  if (!session) throw new AppError(404, "Academic session not found.");
  if (session.status === "archived") {
    throw new AppError(403, "Cannot file leave in an archived session.");
  }

  const absence = await repo.createAbsence({
    schoolId,
    sessionId: parseInt(sessionId),
    facultyId,
    startDate: startOfDay(startDate),
    endDate: endOfDay(rawEnd),
    reason: reason.trim(),
  });

  // Notify the HOD of the teacher's department (non-blocking).
  try {
    const hodUserId = await getHodUserId(departmentId, schoolId);
    if (hodUserId) {
      await notify(
        hodUserId,
        NOTIFICATION_TYPES.ABSENCE_APPLIED,
        `${absence.faculty.user.name} has applied for leave: ${reason.trim()}`,
        "/faculty-absences/department",
      );
    }
  } catch (err) {
    console.error("Failed to send ABSENCE_APPLIED notification:", err);
  }

  return absence;
}

/**
 * getMyAbsences — a teacher's own leave history.
 */
async function getMyAbsences(facultyId, schoolId) {
  return repo.findByFaculty(facultyId, schoolId);
}

/**
 * getDepartmentPending — HOD sees pending requests from their own staff.
 */
async function getDepartmentPending(schoolId, departmentId) {
  return repo.findPendingByDepartment(schoolId, departmentId);
}

// =============================================================================
// 2. HOD APPROVES / REJECTS
// =============================================================================

/**
 * approveAbsence — HOD approves a pending request.
 *
 * Core step: walk every day in the leave range, find the teacher's approved
 * classes on that weekday, and create one substitution row per class (with no
 * substitute yet). Those rows are what the HOD later fills in, and what the
 * timetable views read to cancel/substitute the class.
 *
 * @param {Object} ctx { schoolId, hodUserId, hodDepartmentId }
 * @param {number} id  absence id
 * @returns {Promise<Object>} the approved absence (with its substitution rows)
 */
async function approveAbsence(ctx, id) {
  const { schoolId, hodUserId, hodDepartmentId } = ctx;

  const absence = await loadAbsenceOr404(parseInt(id), schoolId);

  if (absence.status !== "pending") {
    throw new AppError(400, `Only pending requests can be approved (current: "${absence.status}").`);
  }
  // HOD may only approve their own department's staff.
  if (absence.faculty.departmentId !== hodDepartmentId) {
    throw new AppError(403, "You can only review leave for your own department.");
  }

  // ── Build the list of affected classes across the whole range ────────────
  const rows = [];
  const days = eachDateInRange(absence.startDate, absence.endDate);

  for (const day of days) {
    const weekday = getIsoWeekday(day); // 1..7 to match slot.dayOfWeek

    // The teacher's approved classes on this weekday in this session.
    const slots = await repo.findFacultySlotsOnDay({
      schoolId,
      sessionId: absence.sessionId,
      facultyId: absence.facultyId,
      dayOfWeek: weekday,
    });

    // One substitution row per class instance (substitute empty for now).
    for (const slot of slots) {
      rows.push({
        schoolId,
        absenceId: absence.id,
        timetableSlotId: slot.id,
        date: day,
        substituteFacultyId: null,
      });
    }
  }

  // Insert all rows at once (efficient; safe even if the list is empty).
  await repo.createSubstitutions(rows);

  // Flip the absence to approved and record who/when.
  await repo.updateAbsence(absence.id, schoolId, {
    status: "approved",
    reviewedByHodId: hodUserId,
    reviewedAt: new Date(),
    hodComment: null,
  });

  // Notify the teacher.
  try {
    await notify(
      absence.faculty.user.id,
      NOTIFICATION_TYPES.ABSENCE_APPROVED,
      `Your leave from ${days[0].toDateString()} was approved. ` +
        `${rows.length} class(es) affected.`,
      "/faculty-absences/my",
    );
  } catch (err) {
    console.error("Failed to send ABSENCE_APPROVED notification:", err);
  }

  return repo.findAbsenceById(absence.id, schoolId);
}

/**
 * rejectAbsence — HOD rejects a pending request with a required comment.
 *
 * @param {Object} ctx { schoolId, hodUserId, hodDepartmentId }
 * @param {number} id
 * @param {string} comment
 */
async function rejectAbsence(ctx, id, comment) {
  const { schoolId, hodUserId, hodDepartmentId } = ctx;

  if (!comment || !comment.trim()) {
    throw new AppError(400, "A comment is required when rejecting leave.");
  }

  const absence = await loadAbsenceOr404(parseInt(id), schoolId);

  if (absence.status !== "pending") {
    throw new AppError(400, `Only pending requests can be rejected (current: "${absence.status}").`);
  }
  if (absence.faculty.departmentId !== hodDepartmentId) {
    throw new AppError(403, "You can only review leave for your own department.");
  }

  await repo.updateAbsence(absence.id, schoolId, {
    status: "rejected",
    reviewedByHodId: hodUserId,
    reviewedAt: new Date(),
    hodComment: comment.trim(),
  });

  try {
    await notify(
      absence.faculty.user.id,
      NOTIFICATION_TYPES.ABSENCE_REJECTED,
      `Your leave request was rejected: ${comment.trim()}`,
      "/faculty-absences/my",
    );
  } catch (err) {
    console.error("Failed to send ABSENCE_REJECTED notification:", err);
  }

  return repo.findAbsenceById(absence.id, schoolId);
}

// =============================================================================
// 3. HOD ASSIGNS A SUBSTITUTE (per class)
// =============================================================================

/**
 * getSubstitutions — the affected-class rows for one absence (HOD view).
 */
async function getSubstitutions(absenceId, schoolId, hodDepartmentId) {
  const absence = await loadAbsenceOr404(parseInt(absenceId), schoolId);
  if (absence.faculty.departmentId !== hodDepartmentId) {
    throw new AppError(403, "You can only view leave for your own department.");
  }
  return absence.substitutions;
}

/**
 * assignSubstitute — set or clear the substitute for one affected class.
 *
 * Passing substituteFacultyId = null (or omitting it) clears the substitute,
 * which means that class stays cancelled.
 *
 * A chosen substitute must:
 *   - exist and be active in this school
 *   - belong to the same department as the absent teacher
 *   - not be the absent teacher themselves
 *   - be free at that day + time (no overlapping approved class)
 *
 * @param {Object} ctx { schoolId, hodDepartmentId }
 * @param {number} substitutionId
 * @param {Object} body { substituteFacultyId }  (null/absent = cancel)
 * @returns {Promise<Object>} the updated substitution row (re-fetched via absence)
 */
async function assignSubstitute(ctx, substitutionId, body) {
  const { schoolId, hodDepartmentId } = ctx;

  const sub = await repo.findSubstitutionById(parseInt(substitutionId), schoolId);
  if (!sub) throw new AppError(404, "Substitution entry not found.");

  // The parent absence must be approved, and belong to the HOD's department.
  if (sub.absence.status !== "approved") {
    throw new AppError(400, "Substitutes can only be set on an approved absence.");
  }
  if (sub.absence.faculty.departmentId !== hodDepartmentId) {
    throw new AppError(403, "You can only manage leave for your own department.");
  }

  // ── Case A: clearing the substitute (class stays cancelled) ──────────────
  // `== null` is true for both null and undefined.
  if (body.substituteFacultyId == null) {
    await repo.updateSubstitution(sub.id, schoolId, { substituteFacultyId: null });
    return loadAbsenceOr404(sub.absence.id, schoolId);
  }

  // ── Case B: assigning a real substitute — validate them ──────────────────
  const substituteId = parseInt(body.substituteFacultyId);

  if (substituteId === sub.absence.facultyId) {
    throw new AppError(400, "The substitute cannot be the absent teacher.");
  }

  // Must exist, be active, and be in the same department.
  const substitute = await prisma.faculty.findFirst({
    where: { id: substituteId, schoolId, departmentId: hodDepartmentId, deletedAt: null },
    select: { id: true, user: { select: { id: true, name: true } } },
  });
  if (!substitute) {
    throw new AppError(
      400,
      "Substitute must be an active faculty member of your department.",
    );
  }

  // Must be free at that day + time — check their approved classes that weekday.
  const weekday = sub.slot.dayOfWeek;
  const substituteSlots = await repo.findFacultySlotsOnDay({
    schoolId,
    sessionId: sub.absence.sessionId,
    facultyId: substituteId,
    dayOfWeek: weekday,
  });

  for (const other of substituteSlots) {
    if (timesOverlap(sub.slot.startTime, sub.slot.endTime, other.startTime, other.endTime)) {
      throw new AppError(
        409,
        "This substitute already has a class at that day and time.",
      );
    }
  }

  // All checks passed — assign the substitute.
  await repo.updateSubstitution(sub.id, schoolId, { substituteFacultyId: substituteId });

  // Notify the substitute they're covering a class (non-blocking).
  try {
    await notify(
      substitute.user.id,
      NOTIFICATION_TYPES.SUBSTITUTE_ASSIGNED,
      `You have been assigned to cover a class on ${new Date(sub.date).toDateString()}.`,
      "/faculty/timetable",
    );
  } catch (err) {
    console.error("Failed to send SUBSTITUTE_ASSIGNED notification:", err);
  }

  return loadAbsenceOr404(sub.absence.id, schoolId);
}

module.exports = {
  applyForAbsence,
  getMyAbsences,
  getDepartmentPending,
  approveAbsence,
  rejectAbsence,
  getSubstitutions,
  assignSubstitute,
};
