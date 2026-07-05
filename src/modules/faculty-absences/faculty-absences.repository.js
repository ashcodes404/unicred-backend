// =============================================================================
// FACULTY ABSENCES REPOSITORY
// (src/modules/faculty-absences/faculty-absences.repository.js)
// =============================================================================
//
// Two tables live here:
//   FacultyAbsence      → a teacher's leave request (a date range)
//   AbsenceSubstitution → one row PER affected class, holding either a chosen
//                         substitute teacher, or null (meaning that class is
//                         cancelled for the day)
//
// The weekly timetable is never edited. When a teacher is away, we create
// substitution rows on top of it; the timetable views read those rows to show
// the effective schedule. This keeps full history and stays scalable.
//
// Every query is scoped by schoolId for multi-tenant isolation.
//
// =============================================================================

const prisma = require("../../config/db");

// Shape returned for an absence, including the teacher's name and its
// per-class substitution rows (with the joined slot + substitute).
const ABSENCE_SELECT = {
  id: true,
  sessionId: true,
  facultyId: true,
  startDate: true,
  endDate: true,
  reason: true,
  status: true,
  hodComment: true,
  reviewedAt: true,
  createdAt: true,
  faculty: {
    select: {
      id: true,
      departmentId: true,
      user: { select: { id: true, name: true, email: true } },
    },
  },
  session: { select: { id: true, name: true, status: true } },
  substitutions: {
    select: {
      id: true,
      date: true,
      substituteFacultyId: true,
      slot: {
        select: {
          id: true,
          dayOfWeek: true,
          startTime: true,
          endTime: true,
          classroom: true,
          subject: { select: { id: true, courseCode: true, name: true } },
        },
      },
      substituteFaculty: {
        select: {
          id: true,
          user: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: [{ date: "asc" }],
  },
};

// =============================================================================
// ABSENCE — CREATE / READ / UPDATE
// =============================================================================

/**
 * createAbsence — insert a new leave request (status defaults to pending).
 *
 * @param {Object} data { schoolId, sessionId, facultyId, startDate, endDate, reason }
 * @returns {Promise<Object>}
 */
async function createAbsence(data) {
  return prisma.facultyAbsence.create({
    data,
    select: ABSENCE_SELECT,
  });
}

/**
 * findAbsenceById — one absence with its substitutions, scoped to school.
 *
 * @param {number} id
 * @param {number} schoolId
 * @returns {Promise<Object|null>}
 */
async function findAbsenceById(id, schoolId) {
  return prisma.facultyAbsence.findFirst({
    where: { id, schoolId },
    select: ABSENCE_SELECT,
  });
}

/**
 * findByFaculty — all leave requests filed by one teacher (their own view).
 *
 * @param {number} facultyId
 * @param {number} schoolId
 * @returns {Promise<Array>}
 */
async function findByFaculty(facultyId, schoolId) {
  return prisma.facultyAbsence.findMany({
    where: { facultyId, schoolId },
    select: ABSENCE_SELECT,
    orderBy: { createdAt: "desc" },
  });
}

/**
 * findPendingByDepartment — pending requests for a HOD's department.
 *
 * A relation filter (`faculty: { departmentId }`) keeps only absences whose
 * teacher belongs to that department, so a HOD sees only their own staff.
 *
 * @param {number} schoolId
 * @param {number} departmentId
 * @returns {Promise<Array>}
 */
async function findPendingByDepartment(schoolId, departmentId) {
  return prisma.facultyAbsence.findMany({
    where: {
      schoolId,
      status: "pending",
      faculty: { departmentId },
    },
    select: ABSENCE_SELECT,
    orderBy: { createdAt: "asc" }, // oldest first (fair review order)
  });
}

/**
 * updateAbsence — change an absence's own fields (status, comment, reviewer).
 * updateMany keeps schoolId in the where clause for isolation.
 *
 * @param {number} id
 * @param {number} schoolId
 * @param {Object} data
 * @returns {Promise<{count: number}>}
 */
async function updateAbsence(id, schoolId, data) {
  return prisma.facultyAbsence.updateMany({
    where: { id, schoolId },
    data,
  });
}

// =============================================================================
// SLOT LOOKUP — used to enumerate affected classes and to check conflicts
// =============================================================================

/**
 * findFacultySlotsOnDay — approved timetable slots for a given faculty, in a
 * given session, on a given weekday.
 *
 * Two uses:
 *   1. On approval: list the ABSENT teacher's classes so we know which ones to
 *      create substitution rows for.
 *   2. On assigning a substitute: list the SUBSTITUTE's own classes so we can
 *      check they are free at that time.
 *
 * Only approved timetables count — draft/submitted ones aren't live yet.
 *
 * @param {Object} params { schoolId, sessionId, facultyId, dayOfWeek }
 * @returns {Promise<Array>} slots with id, times, classroom, subjectId
 */
async function findFacultySlotsOnDay({ schoolId, sessionId, facultyId, dayOfWeek }) {
  return prisma.timetableSlot.findMany({
    where: {
      schoolId,
      facultyId,
      dayOfWeek,
      timetable: { sessionId, status: "approved" },
    },
    select: {
      id: true,
      startTime: true,
      endTime: true,
      classroom: true,
      subjectId: true,
    },
  });
}

// =============================================================================
// SUBSTITUTIONS
// =============================================================================

/**
 * createSubstitutions — bulk-insert the affected-class rows for an approved
 * absence. Uses createMany for one efficient round-trip instead of many
 * single inserts (scalable for long leaves with many classes).
 *
 * Built-in used:
 *   prisma.absenceSubstitution.createMany({ data }) → inserts an array of rows
 *   in one query and returns { count }.
 *
 * @param {Array<Object>} rows
 * @returns {Promise<{count: number}>}
 */
async function createSubstitutions(rows) {
  if (!rows.length) return { count: 0 };
  return prisma.absenceSubstitution.createMany({ data: rows });
}

/**
 * findSubstitutionById — one substitution row with the info needed to validate
 * a substitute (its slot's day/time and the parent absence's session + the
 * absent teacher + department).
 *
 * @param {number} id
 * @param {number} schoolId
 * @returns {Promise<Object|null>}
 */
async function findSubstitutionById(id, schoolId) {
  return prisma.absenceSubstitution.findFirst({
    where: { id, schoolId },
    select: {
      id: true,
      absenceId: true,
      date: true,
      substituteFacultyId: true,
      slot: {
        select: {
          id: true,
          dayOfWeek: true,
          startTime: true,
          endTime: true,
          classroom: true,
        },
      },
      absence: {
        select: {
          id: true,
          sessionId: true,
          facultyId: true,
          status: true,
          faculty: { select: { departmentId: true } },
        },
      },
    },
  });
}

/**
 * updateSubstitution — set (or clear) the substitute teacher on one row.
 *
 * @param {number} id
 * @param {number} schoolId
 * @param {Object} data  e.g. { substituteFacultyId: 12 } or { substituteFacultyId: null }
 * @returns {Promise<{count: number}>}
 */
async function updateSubstitution(id, schoolId, data) {
  return prisma.absenceSubstitution.updateMany({
    where: { id, schoolId },
    data,
  });
}

module.exports = {
  createAbsence,
  findAbsenceById,
  findByFaculty,
  findPendingByDepartment,
  updateAbsence,
  findFacultySlotsOnDay,
  createSubstitutions,
  findSubstitutionById,
  updateSubstitution,
};
