// =============================================================================
// SCHEDULE EXCEPTIONS SERVICE
// (src/modules/schedule-exceptions/schedule-exceptions.service.js)
// =============================================================================
//
// Business rules for holidays and half-days.
//
// WHO can declare WHAT:
//   - Admin → scope SCHOOL, departmentId = null   (affects the whole school)
//   - HOD   → scope DEPARTMENT, departmentId = their own dept
//   The caller does NOT get to choose scope/department freely; we force it from
//   their role so a HOD can never declare a school-wide holiday.
//
// TYPES:
//   - HOLIDAY  → whole day(s); no startTime/endTime
//   - HALF_DAY → needs a valid startTime–endTime window
//
// On declare we notify everyone affected. On revoke we soft-delete (set
// revokedAt) so the record survives for history/audit.
//
// =============================================================================

const repo        = require("./schedule-exceptions.repository");
const sessionRepo = require("../academic-sessions/academic-sessions.repository");
const prisma      = require("../../config/db");
const AppError    = require("../../utils/AppError");
const { notifyMany } = require("../../utils/notify");
const { isValidTime, isEndAfterStart } = require("../../utils/time");
const {
  isValidDateString,
  startOfDay,
  endOfDay,
  isStartBeforeOrSameDay,
} = require("../../utils/date");
const NOTIFICATION_TYPES = require("../../constants/notificationTypes");
const { parsePagination, buildPaginationMeta } = require("../../utils/pagination");

// The only two valid exception types.
const VALID_TYPES = ["HOLIDAY", "HALF_DAY"];

// =============================================================================
// INTERNAL HELPER — who should be notified?
// =============================================================================

/**
 * getAffectedUserIds — collects the userIds to notify for an exception.
 *
 *   School-wide (departmentId === null):
 *     every active student, faculty, and HOD in the school (one query).
 *   Department-wide (departmentId is a number):
 *     students in that dept + faculty in that dept + the dept's HOD user.
 *
 * We return a de-duplicated array so nobody is notified twice.
 *
 * Built-ins used:
 *   Array.prototype.map(fn)  → pull the id out of each record.
 *   Set                      → a collection that automatically drops duplicates.
 *   [...set]                 → spread the Set back into a plain array.
 *
 * @param {number} schoolId
 * @param {number|null} departmentId
 * @returns {Promise<number[]>}
 */
async function getAffectedUserIds(schoolId, departmentId) {
  // ── School-wide: one simple query over the users table. ──────────────────
  if (departmentId === null) {
    const users = await prisma.user.findMany({
      where: {
        schoolId,
        isActive: true,
        deletedAt: null,
        role: { in: ["student", "faculty", "hod"] }, // everyone except admin
      },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  // ── Department-wide: gather students, faculty, and the HOD of that dept. ──
  const [students, faculty, dept] = await Promise.all([
    prisma.student.findMany({
      where: { schoolId, departmentId, deletedAt: null },
      select: { userId: true },
    }),
    prisma.faculty.findMany({
      where: { schoolId, departmentId, deletedAt: null },
      select: { userId: true },
    }),
    prisma.department.findFirst({
      where: { id: departmentId, schoolId },
      select: { hodUserId: true },
    }),
  ]);

  // A Set removes duplicates (e.g. if the HOD is also listed as faculty).
  const ids = new Set();
  students.forEach((s) => ids.add(s.userId));
  faculty.forEach((f) => ids.add(f.userId));
  if (dept?.hodUserId) ids.add(dept.hodUserId);

  return [...ids];
}

// =============================================================================
// DECLARE
// =============================================================================

/**
 * declareException — Admin or HOD declares a holiday or half-day.
 *
 * @param {Object} ctx
 * @param {number} ctx.schoolId
 * @param {string} ctx.role            "admin" or "hod"
 * @param {number} ctx.userId          the declarer (stored as declaredByUserId)
 * @param {number|null} ctx.hodDepartmentId  HOD's dept (null for admin)
 * @param {Object} body  { sessionId, startDate, endDate?, type, reason,
 *                         startTime?, endTime? }
 * @returns {Promise<Object>} the created exception
 */
async function declareException(ctx, body) {
  const { schoolId, role, userId, hodDepartmentId } = ctx;
  const {
    sessionId,
    startDate,
    endDate,
    type,
    reason,
    startTime,
    endTime,
  } = body;

  // ── Required fields ──────────────────────────────────────────────────────
  if (!sessionId || !startDate || !type || !reason || !reason.trim()) {
    throw new AppError(
      400,
      "sessionId, startDate, type, and reason are required.",
    );
  }

  // ── Type must be one we understand ───────────────────────────────────────
  if (!VALID_TYPES.includes(type)) {
    throw new AppError(400, `type must be one of: ${VALID_TYPES.join(", ")}.`);
  }

  // ── Dates ────────────────────────────────────────────────────────────────
  // A single date is allowed: if endDate is missing we reuse startDate.
  const rawEnd = endDate || startDate;

  if (!isValidDateString(startDate) || !isValidDateString(rawEnd)) {
    throw new AppError(400, "startDate/endDate must be valid dates (YYYY-MM-DD).");
  }
  if (!isStartBeforeOrSameDay(startDate, rawEnd)) {
    throw new AppError(400, "endDate cannot be before startDate.");
  }

  // Normalise to day boundaries so comparisons ignore the time of day.
  const start = startOfDay(startDate);
  const end = endOfDay(rawEnd);

  // ── Half-day needs a valid time window; holiday must NOT have times ──────
  let cleanStartTime = null;
  let cleanEndTime = null;

  if (type === "HALF_DAY") {
    if (!isValidTime(startTime) || !isValidTime(endTime)) {
      throw new AppError(
        400,
        "A HALF_DAY needs a valid startTime and endTime, e.g. 13:00 and 17:00.",
      );
    }
    if (!isEndAfterStart(startTime, endTime)) {
      throw new AppError(400, "endTime must be later than startTime.");
    }
    cleanStartTime = startTime;
    cleanEndTime = endTime;
  }
  // For HOLIDAY we leave both times null (whole day), ignoring any sent times.

  // ── Session must exist and not be archived ───────────────────────────────
  const session = await sessionRepo.findByIdForAnyRole(parseInt(sessionId), schoolId);
  if (!session) {
    throw new AppError(404, "Academic session not found.");
  }
  if (session.status === "archived") {
    throw new AppError(403, "Cannot declare exceptions in an archived session.");
  }

  // ── Scope is decided by ROLE, never trusted from the body ────────────────
  let scope;
  let departmentId;
  if (role === "admin") {
    scope = "SCHOOL";
    departmentId = null; // affects everyone
  } else {
    // role === "hod" (routes guarantee only admin/hod reach here)
    scope = "DEPARTMENT";
    departmentId = hodDepartmentId;
  }

  // ── Create the row ───────────────────────────────────────────────────────
  const created = await repo.create({
    schoolId,
    sessionId: parseInt(sessionId),
    departmentId,
    startDate: start,
    endDate: end,
    type,
    scope,
    startTime: cleanStartTime,
    endTime: cleanEndTime,
    reason: reason.trim(),
    declaredByUserId: userId,
  });

  // ── Notify everyone affected (never let this break the main response) ────
  try {
    const userIds = await getAffectedUserIds(schoolId, departmentId);
    if (userIds.length) {
      const notifType =
        type === "HOLIDAY"
          ? NOTIFICATION_TYPES.HOLIDAY_DECLARED
          : NOTIFICATION_TYPES.HALF_DAY_DECLARED;

      await notifyMany(userIds, notifType, reason.trim(), "/timetables");
    }
  } catch (err) {
    console.error("Failed to send schedule-exception notifications:", err);
  }

  return created;
}

// =============================================================================
// READ
// =============================================================================

/**
 * listExceptions — list exceptions the caller is allowed to see.
 *
 * Scoping by role:
 *   - Admin sees ALL exceptions in the school (school-wide and every dept).
 *   - HOD sees school-wide exceptions PLUS their own department's.
 * Optional query filters: ?sessionId, ?from, ?to, ?includeRevoked=true.
 *
 * NOTE: HOD's "school-wide + own dept" needs an OR, which our generic repo
 * filter doesn't express, so for HOD we fetch and then keep the relevant rows.
 * For large datasets this can later move into the repository as a dedicated
 * query; kept simple and correct here.
 *
 * @param {Object} ctx { schoolId, role, hodDepartmentId }
 * @param {Object} query { sessionId?, from?, to?, includeRevoked? }
 */
async function listExceptions(ctx, query) {
  const { schoolId, role, hodDepartmentId } = ctx;

  const filters = {
    schoolId,
    sessionId: query.sessionId ? parseInt(query.sessionId) : undefined,
    includeRevoked: query.includeRevoked === "true",
    // HOD: school-wide (departmentId null) + their own dept only, pushed
    // into the WHERE clause (not a post-fetch JS filter — see repository's
    // own comment on why that used to be wrong once pagination applies).
    departmentScope: role === "hod" ? hodDepartmentId : undefined,
  };

  // Optional date window (both bounds required to apply it).
  if (query.from && query.to) {
    if (!isValidDateString(query.from) || !isValidDateString(query.to)) {
      throw new AppError(400, "from/to must be valid dates.");
    }
    filters.from = startOfDay(query.from);
    filters.to = endOfDay(query.to);
  }

  // BUG FIX (unbounded list): an admin calling this with no query params
  // used to get every exception ever declared, school-wide, across every
  // session/year, in one response. Now paginated.
  const { page, limit, skip } = parsePagination(query);
  const { rows, total } = await repo.findMany(filters, { skip, limit });
  return { exceptions: rows, pagination: buildPaginationMeta(page, limit, total) };
}

/**
 * getExceptionById — fetch one exception.
 *
 * BUG FIX: this used to only check schoolId, so any HOD in the school could
 * view another department's exception detail just by guessing/incrementing
 * the :id. Now mirrors listExceptions' own viewing rule: an HOD may view a
 * school-wide exception (departmentId === null) or their own department's,
 * but not another department's.
 */
async function getExceptionById(id, ctx) {
  const { schoolId, role, hodDepartmentId } = ctx;
  const exception = await repo.findById(parseInt(id), schoolId);
  if (!exception) {
    throw new AppError(404, "Schedule exception not found.");
  }

  if (role === "hod" && exception.departmentId !== null && exception.departmentId !== hodDepartmentId) {
    throw new AppError(403, "You can only view exceptions for your own department.");
  }

  return exception;
}

// =============================================================================
// REVOKE
// =============================================================================

/**
 * revokeException — soft-cancel an exception.
 *
 * Permission:
 *   - Admin may revoke any exception in the school.
 *   - HOD may revoke only their OWN department's exceptions (not school-wide
 *     ones declared by admin, and not another dept's).
 *
 * @param {Object} ctx { schoolId, role, hodDepartmentId }
 * @param {number} id
 * @returns {Promise<Object>} the revoked exception
 */
async function revokeException(ctx, id) {
  const { schoolId, role, hodDepartmentId } = ctx;
  const exceptionId = parseInt(id);

  const exception = await repo.findById(exceptionId, schoolId);
  if (!exception) {
    throw new AppError(404, "Schedule exception not found.");
  }

  if (exception.revokedAt) {
    throw new AppError(409, "This exception has already been revoked.");
  }

  // HOD may only touch their own department's exceptions.
  if (role === "hod" && exception.departmentId !== hodDepartmentId) {
    throw new AppError(
      403,
      "You can only revoke exceptions for your own department.",
    );
  }

  await repo.revoke(exceptionId, schoolId);
  return repo.findById(exceptionId, schoolId);
}

module.exports = {
  declareException,
  listExceptions,
  getExceptionById,
  revokeException,
};
