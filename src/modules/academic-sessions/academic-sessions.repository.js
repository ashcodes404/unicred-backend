// =============================================================================
// ACADEMIC SESSIONS REPOSITORY
// =============================================================================
//
// What is an Academic Session?
// ----------------------------
// An Academic Session is the top-level wrapper for ALL academic activity.
// Everything in the system — courses, faculty assignments, results,
// timetables, attendance — is linked to a session.
//
// Examples:
//   "2026-27 Odd Semester"   → covers Semesters 1, 3, 5, 7
//   "2026-27 Even Semester"  → covers Semesters 2, 4, 6, 8
//
// Session lifecycle (one-way, no going back):
//   upcoming → active → completed → archived
//
//   upcoming  : Session created but classes haven't started
//   active    : Classes are running right now
//   completed : Teaching and exams finished
//   archived  : Fully closed. All records become READ-ONLY.
//
// Multi-tenancy:
//   Sessions are scoped by schoolId AND departmentId.
//   HOD of CSE can only see/manage CSE sessions.
//   HOD of EE can only see/manage EE sessions.
//
// =============================================================================

const prisma = require("../../config/db");

// =============================================================================
// CREATE
// =============================================================================

/**
 * Create a new academic session.
 *
 * Called when HOD or Admin creates a session like "2026-27 Odd Semester".
 *
 * What does `data` contain?
 *   {
 *     schoolId        : number  — from JWT (never from request body)
 *     departmentId    : number  — HOD's own department
 *     name            : string  — "2026-27 Odd Semester"
 *     academicYear    : string  — "2026-27"
 *     semesterType    : enum    — "odd" | "even"
 *     startDate       : Date
 *     endDate         : Date
 *     status          : enum    — always "upcoming" on creation
 *     createdByUserId : number  — from JWT
 *   }
 *
 * @param {Object} data - Session fields (built by service, schoolId from JWT)
 * @returns {Promise<Object>} - The newly created session
 */
async function createSession(data) {
  return prisma.academicSession.create({
    data,

    select: {
      id: true,
      name: true,
      academicYear: true,
      semesterType: true,
      startDate: true,
      endDate: true,
      status: true,
      departmentId: true,
      createdByUserId: true,
      createdAt: true,
    },
  });
}

// =============================================================================
// READ
// =============================================================================

/**
 * Get all sessions for a department within a school.
 *
 * Used by:
 *   - HOD: to see all sessions they manage
 *   - Faculty/Students: to see available sessions
 *
 * Why filter by both schoolId AND departmentId?
 *   HOD of CSE in School A should only see CSE sessions.
 *   Not EE sessions. Not sessions from School B.
 *   Both filters together enforce this isolation.
 *
 * Optional status filter:
 *   Pass status = "active" to get only the running session.
 *   Omit to get all sessions.
 *
 * @param {number} schoolId      - From JWT
 * @param {number} departmentId  - HOD's department
 * @param {string} [status]      - Optional: filter by status
 * @returns {Promise<Array>}
 */
async function findAllByDepartment(schoolId, departmentId, status = null) {
  return prisma.academicSession.findMany({
    where: {
      schoolId,
      departmentId,

      // Only apply status filter if explicitly provided
      ...(status ? { status } : {}),
    },

    select: {
      id: true,
      name: true,
      academicYear: true,
      semesterType: true,
      startDate: true,
      endDate: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },

    orderBy: { createdAt: "desc" },
  });
}

/**
 * Find a single session by ID.
 *
 * schoolId + departmentId in WHERE = cross-school and cross-department
 * access is impossible.
 *
 * Returns department name so the response is self-describing
 * (frontend doesn't need a second API call to get dept name).
 *
 * @param {number} sessionId     - Session primary key
 * @param {number} schoolId      - School isolation
 * @param {number} departmentId  - Department isolation
 * @returns {Promise<Object|null>}
 */
async function findById(sessionId, schoolId, departmentId) {
  return prisma.academicSession.findFirst({
    where: {
      id: sessionId,
      schoolId,
      departmentId,
    },

    select: {
      id: true,
      name: true,
      academicYear: true,
      semesterType: true,
      startDate: true,
      endDate: true,
      status: true,
      createdByUserId: true,
      createdAt: true,
      updatedAt: true,

      department: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
}

/**
 * Find the currently ACTIVE session for a department.
 *
 * Why is this a dedicated function?
 *   Many operations (mark attendance, view timetable, register for session)
 *   need to know: "What session is running right now?"
 *
 *   Instead of every service building this query, it lives here once.
 *
 * Business rule enforced in service:
 *   Only ONE active session per department at a time.
 *   This function returns it (or null if none active).
 *
 * @param {number} schoolId      - School isolation
 * @param {number} departmentId  - Department isolation
 * @returns {Promise<Object|null>}
 */
async function findActiveSession(schoolId, departmentId) {
  return prisma.academicSession.findFirst({
    where: {
      schoolId,
      departmentId,
      status: "active",
    },

    select: {
      id: true,
      name: true,
      academicYear: true,
      semesterType: true,
      startDate: true,
      endDate: true,
      status: true,
    },
  });
}

/**
 * Find session by ID only (no department filter).
 *
 * When is this used instead of findById?
 *   When a student or faculty member (not HOD) fetches a session.
 *   They don't "own" a department — they just need the session by ID
 *   with school isolation only.
 *
 * @param {number} sessionId - Session primary key
 * @param {number} schoolId  - School isolation
 * @returns {Promise<Object|null>}
 */
async function findByIdForAnyRole(sessionId, schoolId) {
  return prisma.academicSession.findFirst({
    where: {
      id: sessionId,
      schoolId,
    },

    select: {
      id: true,
      name: true,
      academicYear: true,
      semesterType: true,
      startDate: true,
      endDate: true,
      status: true,
      departmentId: true,

      department: {
        select: { id: true, name: true },
      },
    },
  });
}

// =============================================================================
// UPDATE
// =============================================================================

/**
 * Update session fields (name, dates, etc.)
 *
 * Why updateMany?
 *   Lets us include schoolId + departmentId in WHERE.
 *   If session doesn't belong to this HOD's department → 0 rows updated.
 *   Service checks count and returns 404.
 *
 * What fields can be updated?
 *   name, startDate, endDate — managed by service validation.
 *   status is updated via updateSessionStatus (separate function below)
 *   for clarity and explicit lifecycle control.
 *
 * @param {number} sessionId     - Session primary key
 * @param {number} schoolId      - School isolation
 * @param {number} departmentId  - Department isolation
 * @param {Object} data          - Fields to update
 * @returns {Promise<{count: number}>}
 */
async function updateSession(sessionId, schoolId, departmentId, data) {
  return prisma.academicSession.updateMany({
    where: {
      id: sessionId,
      schoolId,
      departmentId,
    },

    data,
  });
}

/**
 * Update ONLY the status of a session.
 *
 * Why a separate function for status?
 *   Status transitions have strict rules (upcoming→active→completed→archived).
 *   Keeping status updates isolated makes it easy to audit and control
 *   which transitions are allowed (that logic lives in the service).
 *
 * @param {number} sessionId     - Session primary key
 * @param {number} schoolId      - School isolation
 * @param {number} departmentId  - Department isolation
 * @param {string} newStatus     - New status value
 * @returns {Promise<{count: number}>}
 */
async function updateSessionStatus(sessionId, schoolId, departmentId, newStatus) {
  return prisma.academicSession.updateMany({
    where: {
      id: sessionId,
      schoolId,
      departmentId,
    },

    data: {
      status: newStatus,
    },
  });
}

/**
 * Get session by ID — returns only id and status.
 *
 * Lightweight query used by service to:
 *   1. Check if session exists
 *   2. Read current status before deciding if a transition is allowed
 *
 * Example:
 *   Service wants to move session from "active" → "completed"
 *   First calls this to confirm current status is actually "active"
 *   before updating.
 *
 * @param {number} sessionId     - Session primary key
 * @param {number} schoolId      - School isolation
 * @param {number} departmentId  - Department isolation
 * @returns {Promise<{id: number, status: string}|null>}
 */
async function findStatusById(sessionId, schoolId, departmentId) {
  return prisma.academicSession.findFirst({
    where: {
      id: sessionId,
      schoolId,
      departmentId,
    },

    select: {
      id: true,
      status: true,
    },
  });
}

/**
 * Check if a session already exists for this dept + academicYear + semesterType.
 *
 * Prevents HOD from creating duplicate sessions like:
 *   "2026-27 Odd Semester" twice for the same department.
 *
 * @param {number} schoolId
 * @param {number} departmentId
 * @param {string} academicYear  - e.g. "2026-27"
 * @param {string} semesterType  - "odd" | "even"
 * @returns {Promise<{id: number}|null>}
 */
async function findDuplicateSession(schoolId, departmentId, academicYear, semesterType) {
  return prisma.academicSession.findFirst({
    where: {
      schoolId,
      departmentId,
      academicYear,
      semesterType,
    },
    select: { id: true, name: true },
  });
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  createSession,
  findAllByDepartment,
  findById,
  findActiveSession,
  findByIdForAnyRole,
  updateSession,
  updateSessionStatus,
  findStatusById,
  findDuplicateSession,
};
