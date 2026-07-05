// =============================================================================
// STUDENT SESSION REGISTRATION REPOSITORY
// =============================================================================
//
// A StudentSessionRegistration enrolls a student into an academic session.
//
// After registration, the system knows:
//   - Which session this student is currently in
//   - Their semesterNumber and batchYear for this session
//   - Their status: active | completed | detained
//
// Status lifecycle:
//   active    → student is currently enrolled, results not yet published
//   completed → passed all subjects, promoted to next semester
//   detained  → failed one or more subjects, not promoted
//
// This table is updated by the promotion logic (Phase 5) after
// HOD publishes results.
//
// =============================================================================

const prisma = require("../../config/db");

/**
 * Register a student into an academic session.
 *
 * @param {Object} data - { schoolId, studentId, sessionId,
 *                          semesterNumber, batchYear, status }
 * @returns {Promise<Object>}
 */
async function createRegistration(data) {
  return prisma.studentSessionRegistration.create({
    data,

    select: {
      id: true,
      semesterNumber: true,
      batchYear: true,
      status: true,
      createdAt: true,

      student: {
        select: {
          id: true,
          rollNo: true,
          user: { select: { id: true, name: true, email: true } },
        },
      },

      session: {
        select: { id: true, name: true, status: true },
      },
    },
  });
}

/**
 * Find registration for a specific student in a specific session.
 *
 * Used to:
 *   - Check if student is already registered (prevent duplicates)
 *   - Update status after promotion
 *
 * @param {number} studentId - Student primary key
 * @param {number} sessionId - Session primary key
 * @returns {Promise<Object|null>}
 */
async function findByStudentAndSession(studentId, sessionId) {
  return prisma.studentSessionRegistration.findFirst({
    where: {
      studentId,
      sessionId,
    },

    select: {
      id: true,
      semesterNumber: true,
      batchYear: true,
      status: true,
    },
  });
}

/**
 * Find the student's current ACTIVE registration.
 *
 * "Active" = currently enrolled, results not yet published.
 * Returns the session details so the service can extract
 * sessionId and semesterNumber for other queries.
 *
 * @param {number} studentId - Student primary key
 * @param {number} schoolId  - School isolation
 * @returns {Promise<Object|null>}
 */
async function findActiveRegistration(studentId, schoolId) {
  return prisma.studentSessionRegistration.findFirst({
    where: {
      studentId,
      schoolId,
      status: "active",
    },

    select: {
      id: true,
      semesterNumber: true,
      batchYear: true,
      status: true,

      session: {
        select: {
          id: true,
          name: true,
          academicYear: true,
          semesterType: true,
          startDate: true,
          endDate: true,
          status: true,
          departmentId: true,
        },
      },
    },
  });
}

/**
 * Find all registrations for all students in a session.
 *
 * HOD uses this to see which students are registered for a session.
 * Optional filter by semesterNumber or batchYear.
 *
 * @param {number} schoolId       - School isolation
 * @param {number} sessionId      - Which session
 * @param {Object} filters        - { semesterNumber?, batchYear? }
 * @returns {Promise<Array>}
 */
async function findAllBySession(schoolId, sessionId, filters = {}) {
  const { semesterNumber, batchYear } = filters;

  return prisma.studentSessionRegistration.findMany({
    where: {
      schoolId,
      sessionId,
      ...(semesterNumber ? { semesterNumber: parseInt(semesterNumber) } : {}),
      ...(batchYear      ? { batchYear:      parseInt(batchYear) }      : {}),
    },

    select: {
      id: true,
      semesterNumber: true,
      batchYear: true,
      status: true,

      student: {
        select: {
          id: true,
          rollNo: true,
          branch: true,
          batchYear: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              profilePhotoUrl: true,
            },
          },
          department: {
            select: { id: true, name: true },
          },
        },
      },
    },

    orderBy: { student: { rollNo: "asc" } },
  });
}

/**
 * Update a registration's status.
 *
 * Called by the promotion service (Phase 5) after result publication:
 *   passed all → status = "completed"
 *   failed any → status = "detained"
 *
 * schoolId is required (not currently called from anywhere, but every other
 * write in this file takes it — dropping it here would let a future caller
 * update a registration in ANY school just by its id).
 *
 * @param {number} registrationId - Registration primary key
 * @param {number} schoolId       - Tenant scope
 * @param {string} status         - New status
 * @returns {Promise<{count: number}>}
 */
async function updateStatus(registrationId, schoolId, status) {
  return prisma.studentSessionRegistration.updateMany({
    where: { id: registrationId, schoolId },
    data:  { status },
  });
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  createRegistration,
  findByStudentAndSession,
  findActiveRegistration,
  findAllBySession,
  updateStatus,
};
