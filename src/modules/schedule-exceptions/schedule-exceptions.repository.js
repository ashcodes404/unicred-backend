// =============================================================================
// SCHEDULE EXCEPTIONS REPOSITORY
// (src/modules/schedule-exceptions/schedule-exceptions.repository.js)
// =============================================================================
//
// A "schedule exception" is a holiday or a half-day that OVERRIDES the normal
// repeating weekly timetable for a date or a date range. We never edit the
// timetable itself — these rows sit on top of it, so history stays intact.
//
//   type  = HOLIDAY  → the whole day (or range of days) has no class
//   type  = HALF_DAY → classes inside a start–end time window are cancelled
//   scope = SCHOOL   → declared by admin, affects every department
//   scope = DEPARTMENT → declared by HOD, affects only their department
//
// This file is the ONLY place that touches the database for exceptions. Every
// query is scoped by schoolId to keep one school's data separate from another.
//
// =============================================================================

const prisma = require("../../config/db");

// Reusable "select" shape — the fields every read returns. Declared once so all
// reads stay consistent. It includes the declarer's name so the frontend can
// show "Declared by ...".
const EXCEPTION_SELECT = {
  id: true,
  sessionId: true,
  departmentId: true,
  startDate: true,
  endDate: true,
  type: true,
  scope: true,
  startTime: true,
  endTime: true,
  reason: true,
  revokedAt: true,
  createdAt: true,
  session: { select: { id: true, name: true } },
};

/**
 * create — insert one schedule exception.
 *
 * Built-in used:
 *   prisma.scheduleException.create({ data, select }) → inserts one row and
 *   returns only the selected fields.
 *
 * @param {Object} data  all column values for the new row
 * @returns {Promise<Object>}
 */
async function create(data) {
  return prisma.scheduleException.create({
    data,
    select: EXCEPTION_SELECT,
  });
}

/**
 * findById — fetch one exception by id, scoped to the school.
 *
 * findFirst (not findUnique) is used because we filter by id AND schoolId
 * together for tenant safety.
 *
 * @param {number} id
 * @param {number} schoolId
 * @returns {Promise<Object|null>}
 */
async function findById(id, schoolId) {
  return prisma.scheduleException.findFirst({
    where: { id, schoolId },
    select: { ...EXCEPTION_SELECT, declaredByUserId: true },
  });
}

/**
 * findMany — list exceptions with flexible, optional filters.
 *
 * The caller can narrow the list by session, by department, by whether it is
 * revoked, and by an overlapping date window. Any filter left out is simply not
 * applied (we build the `where` object step by step).
 *
 * Overlap logic for the date window: an exception overlaps [from, to] when its
 * startDate <= to AND its endDate >= from. This catches ranges that partially
 * cover the window, not just ones fully inside it.
 *
 * @param {Object} filters
 * @param {number} filters.schoolId       required — tenant scope
 * @param {number} [filters.sessionId]
 * @param {number|null} [filters.departmentId]  see note in service on scoping
 * @param {boolean} [filters.includeRevoked] default false = hide revoked
 * @param {Date} [filters.from]           window start (optional)
 * @param {Date} [filters.to]             window end (optional)
 * @returns {Promise<Array>}
 */
// skip/limit are optional (no current frontend caller yet, so this stays
// backward compatible for any internal use that wants the full list).
async function findMany(filters, { skip, limit } = {}) {
  const {
    schoolId,
    sessionId,
    departmentId,
    // BUG FIX (correctness + pagination): the HOD "school-wide + own dept
    // only" restriction used to be applied by fetching EVERY row in the
    // school and filtering in JS afterward — which silently broke as soon
    // as pagination was added (a HOD's page 1 could come back nearly empty
    // even with more matching rows on page 2, and the total count would be
    // wrong). Pushing it into the WHERE clause via OR makes both correct.
    departmentScope,
    includeRevoked = false,
    from,
    to,
  } = filters;

  // Start with the required tenant scope, then add filters conditionally.
  const where = { schoolId };

  if (sessionId) where.sessionId = sessionId;

  // departmentId can be a number (a dept) or explicitly null (school-wide).
  // We only add the filter when the caller passed something meaningful.
  if (departmentId !== undefined) where.departmentId = departmentId;

  if (departmentScope !== undefined) {
    where.OR = [{ departmentId: null }, { departmentId: departmentScope }];
  }

  // By default hide revoked rows; `revokedAt: null` means "not revoked".
  if (!includeRevoked) where.revokedAt = null;

  // Date-window overlap (only when both bounds are given).
  if (from && to) {
    where.startDate = { lte: to };   // lte = less-than-or-equal
    where.endDate = { gte: from };   // gte = greater-than-or-equal
  }

  if (skip === undefined) {
    return prisma.scheduleException.findMany({
      where,
      select: EXCEPTION_SELECT,
      orderBy: { startDate: "asc" },
    });
  }

  const [rows, total] = await Promise.all([
    prisma.scheduleException.findMany({
      where,
      select: EXCEPTION_SELECT,
      orderBy: { startDate: "asc" },
      skip,
      take: limit,
    }),
    prisma.scheduleException.count({ where }),
  ]);
  return { rows, total };
}

/**
 * findActiveForDate — every NON-revoked exception that covers a specific day
 * and applies to a given department (either school-wide, or that exact dept).
 *
 * This is the query the timetable views will use to answer "is there a holiday
 * today?" It is written now so System B and the later views share one source
 * of truth.
 *
 * @param {Object} params
 * @param {number} params.schoolId
 * @param {number} params.sessionId
 * @param {number} params.departmentId  the viewer's department
 * @param {Date} params.day             the calendar day to check (00:00)
 * @returns {Promise<Array>}
 */
async function findActiveForDate({ schoolId, sessionId, departmentId, day }) {
  return prisma.scheduleException.findMany({
    where: {
      schoolId,
      sessionId,
      revokedAt: null,
      // The day must sit within [startDate, endDate].
      startDate: { lte: day },
      endDate: { gte: day },
      // Applies if it is school-wide (departmentId null) OR this dept.
      OR: [{ departmentId: null }, { departmentId }],
    },
    select: EXCEPTION_SELECT,
    orderBy: { startDate: "asc" },
  });
}

/**
 * revoke — soft-cancel an exception by stamping revokedAt (keeps history).
 * updateMany is used so schoolId can stay in the where clause for isolation.
 *
 * @param {number} id
 * @param {number} schoolId
 * @returns {Promise<{count: number}>}
 */
async function revoke(id, schoolId) {
  return prisma.scheduleException.updateMany({
    where: { id, schoolId, revokedAt: null }, // only revoke if not already revoked
    data: { revokedAt: new Date() },
  });
}

module.exports = {
  create,
  findById,
  findMany,
  findActiveForDate,
  revoke,
};
