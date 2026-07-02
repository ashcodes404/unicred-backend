// =============================================================================
// TIMETABLES REPOSITORY  (src/modules/timetables/timetables.repository.js)
// =============================================================================
//
// The "repository" is the ONLY layer that talks to the database (Prisma).
// Keeping database code in one place means the service layer can focus purely
// on rules, and if the database ever changes we only edit this file.
//
// What is a Timetable here?
//   One week of classes for a group of students = (session + batch + semester).
//   That single week repeats for the whole session — there are no per-date
//   rows. A weekly day off (say Sunday) is just a day with zero slots.
//
// Lifecycle of a timetable's `status`:
//   draft → submitted → approved
//                 ↘ returned ↗   (admin sends it back, HOD fixes, resubmits)
//
// A "slot" is one class block: one subject, one faculty, one room, one weekday,
// one time range.
//
// EVERY query below includes `schoolId`. This app is multi-tenant (many schools
// share one database), so forgetting schoolId would leak one school's data to
// another. It is intentionally repeated in every where-clause.
//
// =============================================================================

// Prisma is the database client. `prisma.timetable`, `prisma.timetableSlot`,
// etc. map to tables in the schema.
const prisma = require("../../config/db");

// -----------------------------------------------------------------------------
// Reusable "select" shapes.
// A Prisma `select` lists exactly which columns/relations to return. Declaring
// them once (instead of re-typing per query) keeps every read consistent and
// avoids accidentally returning sensitive columns.
// -----------------------------------------------------------------------------

// Shape of a single slot, including the joined subject + teacher, so the
// frontend can draw a readable grid without extra requests.
const SLOT_SELECT = {
  id: true,
  dayOfWeek: true,
  startTime: true,
  endTime: true,
  classroom: true,
  slotType: true,
  subject: {
    select: { id: true, courseCode: true, name: true, subjectType: true },
  },
  faculty: {
    select: {
      id: true,
      designation: true,
      user: { select: { id: true, name: true } },
    },
  },
};

// Shape of a full timetable with all its slots, ordered for display
// (day ascending, then start time ascending).
const TIMETABLE_SELECT = {
  id: true,
  sessionId: true,
  departmentId: true,
  batchYear: true,
  semesterNumber: true,
  status: true,
  submittedAt: true,
  approvedAt: true,
  adminComment: true,
  createdAt: true,
  updatedAt: true,
  session: { select: { id: true, name: true, status: true } },
  slots: {
    select: SLOT_SELECT,
    orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
  },
};

// =============================================================================
// TIMETABLE — CREATE / READ / UPDATE
// =============================================================================

/**
 * createTimetable — inserts a new, empty timetable (status defaults to draft).
 * Slots are added later through the slot endpoints.
 *
 * Built-in used:
 *   prisma.timetable.create({ data, select }) → inserts one row and returns
 *   only the selected fields.
 *
 * @param {Object} data  { schoolId, sessionId, departmentId, batchYear, semesterNumber }
 * @returns {Promise<Object>} the created timetable (slots array will be empty)
 */
async function createTimetable(data) {
  return prisma.timetable.create({
    data,
    select: TIMETABLE_SELECT,
  });
}

/**
 * findById — fetch one timetable (with slots), scoped to the school.
 *
 * Built-in used:
 *   prisma.timetable.findFirst({ where }) → returns the first matching row or
 *   null. We use findFirst (not findUnique) because we filter by BOTH id and
 *   schoolId together.
 *
 * @param {number} id
 * @param {number} schoolId
 * @returns {Promise<Object|null>}
 */
async function findById(id, schoolId) {
  return prisma.timetable.findFirst({
    where: { id, schoolId },
    select: TIMETABLE_SELECT,
  });
}

/**
 * findAllByDepartment — list timetables for one department (HOD view),
 * optionally filtered by session.
 *
 * `_count` asks Prisma to return just the NUMBER of related slots instead of
 * loading them all — a cheap way to show "12 classes" in a list.
 *
 * @param {number} schoolId
 * @param {number} departmentId
 * @param {number|null} sessionId  optional filter
 * @returns {Promise<Array>}
 */
async function findAllByDepartment(schoolId, departmentId, sessionId = null) {
  return prisma.timetable.findMany({
    where: {
      schoolId,
      departmentId,
      // Spread (`...`) conditionally adds the sessionId filter only when given.
      ...(sessionId ? { sessionId } : {}),
    },
    select: {
      id: true,
      sessionId: true,
      batchYear: true,
      semesterNumber: true,
      status: true,
      submittedAt: true,
      approvedAt: true,
      createdAt: true,
      session: { select: { id: true, name: true } },
      _count: { select: { slots: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * findDuplicate — is there already a timetable for this exact
 * session + department + batch + semester? (matches the schema's unique key)
 * Stops two timetables fighting over the same students.
 *
 * @returns {Promise<Object|null>}
 */
async function findDuplicate(sessionId, departmentId, batchYear, semesterNumber) {
  return prisma.timetable.findFirst({
    where: { sessionId, departmentId, batchYear, semesterNumber },
    select: { id: true },
  });
}

/**
 * updateTimetable — change a timetable's own fields (status, comment, etc.).
 *
 * Built-in used:
 *   prisma.timetable.updateMany({ where, data }) → updates every row matching
 *   the where clause and returns { count }. We use updateMany (not update) so
 *   we can include schoolId in the where and guarantee school isolation.
 *
 * @param {number} id
 * @param {number} schoolId
 * @param {Object} data
 * @returns {Promise<{count: number}>}
 */
async function updateTimetable(id, schoolId, data) {
  return prisma.timetable.updateMany({
    where: { id, schoolId },
    data,
  });
}

// =============================================================================
// ADMIN LISTING
// =============================================================================

/**
 * findAllByStatus — list every timetable in a given status across the WHOLE
 * school (admin reviews all departments, so this is school-scoped but not
 * department-scoped). Ordered oldest-first so admins clear the queue fairly.
 *
 * @param {number} schoolId
 * @param {string} status  e.g. "submitted"
 * @returns {Promise<Array>}
 */
async function findAllByStatus(schoolId, status) {
  return prisma.timetable.findMany({
    where: { schoolId, status },
    select: {
      id: true,
      sessionId: true,
      departmentId: true,
      batchYear: true,
      semesterNumber: true,
      status: true,
      submittedAt: true,
      session: { select: { id: true, name: true } },
      _count: { select: { slots: true } },
    },
    orderBy: { submittedAt: "asc" },
  });
}

// =============================================================================
// SLOTS — CREATE / READ / UPDATE / DELETE
// =============================================================================

/**
 * createSlot — insert one class block into a timetable.
 *
 * @param {Object} data  { schoolId, timetableId, subjectId, facultyId,
 *                         dayOfWeek, startTime, endTime, classroom, slotType }
 * @returns {Promise<Object>}
 */
async function createSlot(data) {
  return prisma.timetableSlot.create({
    data,
    select: SLOT_SELECT,
  });
}

/**
 * findSlotById — fetch one slot (raw fields), scoped to school.
 * Returns the plain columns because the service needs them to merge edits and
 * to re-check conflicts.
 *
 * @param {number} slotId
 * @param {number} schoolId
 * @returns {Promise<Object|null>}
 */
async function findSlotById(slotId, schoolId) {
  return prisma.timetableSlot.findFirst({
    where: { id: slotId, schoolId },
    select: {
      id: true,
      timetableId: true,
      subjectId: true,
      facultyId: true,
      dayOfWeek: true,
      startTime: true,
      endTime: true,
      classroom: true,
      slotType: true,
    },
  });
}

/**
 * findConflictCandidates — the query behind conflict detection.
 *
 * It returns every EXISTING slot in the same SESSION, on the same WEEKDAY, that
 * uses either the same faculty OR the same classroom. The service then runs the
 * time-overlap test on this small list.
 *
 * Why session-wide instead of just this one timetable? A teacher teaches many
 * batches. If we only looked inside the current timetable, the same teacher
 * could be booked at 9am in two different batches. The same idea protects a
 * shared classroom.
 *
 * `timetable: { sessionId }` is a "relation filter": keep only slots whose
 * parent timetable belongs to this session.
 * `excludeSlotId` lets an edit ignore the slot being edited so it can't clash
 * with itself.
 *
 * @param {Object} params { schoolId, sessionId, dayOfWeek, facultyId,
 *                          classroom, excludeSlotId }
 * @returns {Promise<Array>} candidate slots to overlap-test
 */
async function findConflictCandidates({
  schoolId,
  sessionId,
  dayOfWeek,
  facultyId,
  classroom,
  excludeSlotId = null,
}) {
  return prisma.timetableSlot.findMany({
    where: {
      schoolId,
      dayOfWeek,
      timetable: { sessionId },
      // `OR` = match slots for the same teacher OR the same room.
      OR: [{ facultyId }, { classroom }],
      // `id: { not: X }` excludes the slot being edited.
      ...(excludeSlotId ? { id: { not: excludeSlotId } } : {}),
    },
    select: {
      id: true,
      facultyId: true,
      classroom: true,
      startTime: true,
      endTime: true,
    },
  });
}

/**
 * countSlots — how many slots does a timetable have?
 *
 * Built-in used:
 *   prisma.timetableSlot.count({ where }) → returns a number, not rows.
 *
 * @param {number} timetableId
 * @param {number} schoolId
 * @returns {Promise<number>}
 */
async function countSlots(timetableId, schoolId) {
  return prisma.timetableSlot.count({
    where: { timetableId, schoolId },
  });
}

/**
 * updateSlot — change an existing slot's fields, scoped to school.
 * updateMany is used (like above) so schoolId can live in the where clause.
 *
 * @param {number} slotId
 * @param {number} schoolId
 * @param {Object} data
 * @returns {Promise<{count: number}>}
 */
async function updateSlot(slotId, schoolId, data) {
  return prisma.timetableSlot.updateMany({
    where: { id: slotId, schoolId },
    data,
  });
}

/**
 * deleteSlot — remove one slot, scoped to school.
 *
 * Built-in used:
 *   prisma.timetableSlot.deleteMany({ where }) → deletes matching rows and
 *   returns { count }. deleteMany (not delete) lets us filter by schoolId too.
 *
 * @param {number} slotId
 * @param {number} schoolId
 * @returns {Promise<{count: number}>}
 */
async function deleteSlot(slotId, schoolId) {
  return prisma.timetableSlot.deleteMany({
    where: { id: slotId, schoolId },
  });
}

// =============================================================================
// DEPARTMENT TIMETABLE DOCUMENT (uploaded PDF/image — one per department)
// =============================================================================

/**
 * upsertDepartmentDocument — create or replace a department's timetable file.
 * departmentId is unique, so a second upload overwrites the first.
 *
 * @param {number} schoolId
 * @param {number} departmentId
 * @param {string} fileUrl
 * @param {number} uploadedById  user id of the HOD
 * @returns {Promise<Object>}
 */
async function upsertDepartmentDocument(schoolId, departmentId, fileUrl, uploadedById) {
  return prisma.departmentTimetable.upsert({
    where:  { departmentId },
    update: { fileUrl, uploadedById, schoolId },
    create: { schoolId, departmentId, fileUrl, uploadedById },
  });
}

/**
 * findDepartmentDocument — the current timetable file for one department, or
 * null if the HOD hasn't uploaded one yet.
 *
 * @param {number} schoolId
 * @param {number} departmentId
 * @returns {Promise<Object|null>}
 */
async function findDepartmentDocument(schoolId, departmentId) {
  return prisma.departmentTimetable.findFirst({
    where: { schoolId, departmentId },
    select: { id: true, departmentId: true, fileUrl: true, updatedAt: true },
  });
}

// =============================================================================
// EXPORTS — make these functions available to the service layer.
// =============================================================================

module.exports = {
  createTimetable,
  findById,
  findAllByDepartment,
  upsertDepartmentDocument,
  findDepartmentDocument,
  findDuplicate,
  updateTimetable,
  findAllByStatus,
  createSlot,
  findSlotById,
  findConflictCandidates,
  countSlots,
  updateSlot,
  deleteSlot,
};
