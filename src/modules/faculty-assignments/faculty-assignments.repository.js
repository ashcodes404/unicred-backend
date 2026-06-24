// =============================================================================
// FACULTY ASSIGNMENTS REPOSITORY
// =============================================================================
//
// A FacultyAssignment says:
//   "Dr. Sharma teaches EE301 for Batch 2024, Semester 3, in Session X."
//
// Created by HOD. Faculty can ONLY submit results for assigned subjects.
// HOD can assign themselves if they are also teaching.
//
// This table is the gatekeeper for:
//   - Which faculty can upload marks for which subject
//   - Which subjects appear on a faculty member's dashboard
//   - Which faculty can be added to timetable slots (Phase 3)
//   - Completion tracking for ResultPublication (Phase 2)
//
// =============================================================================

const prisma = require("../../config/db");

/**
 * Create a faculty assignment.
 *
 * @param {Object} data - { schoolId, sessionId, facultyId, subjectId,
 *                          departmentId, semesterNumber, batchYear, assignedByHodId }
 * @returns {Promise<Object>}
 */
async function createAssignment(data) {
  return prisma.facultyAssignment.create({
    data,

    select: {
      id: true,
      sessionId: true,
      facultyId: true,
      subjectId: true,
      semesterNumber: true,
      batchYear: true,
      createdAt: true,

      faculty: {
        select: {
          id: true,
          designation: true,
          user: { select: { id: true, name: true, email: true } },
        },
      },

      subject: {
        select: { id: true, courseCode: true, name: true },
      },

      session: {
        select: { id: true, name: true },
      },
    },
  });
}

/**
 * Find all assignments for a session within a department.
 *
 * HOD uses this to see the full assignment picture:
 * "Who is teaching what, for which batch, this session?"
 *
 * @param {number} schoolId      - School isolation
 * @param {number} sessionId     - Which session
 * @param {number} departmentId  - Department isolation
 * @returns {Promise<Array>}
 */
async function findAllBySession(schoolId, sessionId, departmentId) {
  return prisma.facultyAssignment.findMany({
    where: {
      schoolId,
      sessionId,
      departmentId,
    },

    select: {
      id: true,
      semesterNumber: true,
      batchYear: true,
      createdAt: true,

      faculty: {
        select: {
          id: true,
          designation: true,
          user: {
            select: { id: true, name: true, email: true, profilePhotoUrl: true },
          },
        },
      },

      subject: {
        select: { id: true, courseCode: true, name: true, subjectType: true },
      },
    },

    orderBy: [
      { semesterNumber: "asc" },
      { subject: { courseCode: "asc" } },
    ],
  });
}

/**
 * Find all assignments for a specific faculty member.
 *
 * Faculty uses this to see their own teaching load:
 * "What am I teaching this session?"
 *
 * @param {number} facultyId - Faculty primary key
 * @param {number} schoolId  - School isolation
 * @param {number} sessionId - Which session (optional — null returns all sessions)
 * @returns {Promise<Array>}
 */
async function findByFaculty(facultyId, schoolId, sessionId = null) {
  return prisma.facultyAssignment.findMany({
    where: {
      facultyId,
      schoolId,
      ...(sessionId ? { sessionId } : {}),
    },

    select: {
      id: true,
      semesterNumber: true,
      batchYear: true,

      subject: {
        select: {
          id: true,
          courseCode: true,
          name: true,
          credits: true,
          subjectType: true,
        },
      },

      session: {
        select: { id: true, name: true, status: true },
      },
    },

    orderBy: { createdAt: "desc" },
  });
}

/**
 * Find a single assignment by ID.
 *
 * @param {number} assignmentId - Assignment primary key
 * @param {number} schoolId     - School isolation
 * @returns {Promise<Object|null>}
 */
async function findById(assignmentId, schoolId) {
  return prisma.facultyAssignment.findFirst({
    where: {
      id: assignmentId,
      schoolId,
    },

    select: {
      id: true,
      sessionId: true,
      facultyId: true,
      subjectId: true,
      departmentId: true,
      semesterNumber: true,
      batchYear: true,
      assignedByHodId: true,

      faculty: {
        select: {
          id: true,
          user: { select: { id: true, name: true, email: true } },
        },
      },

      subject: {
        select: { id: true, courseCode: true, name: true },
      },

      session: {
        select: { id: true, name: true, status: true },
      },
    },
  });
}

/**
 * Check if an assignment already exists.
 *
 * Prevents duplicate: same faculty teaching same subject for same batch in same session.
 *
 * @param {number} sessionId  - Session ID
 * @param {number} facultyId  - Faculty ID
 * @param {number} subjectId  - Subject ID
 * @param {number} batchYear  - Batch year
 * @returns {Promise<Object|null>}
 */
async function findDuplicate(sessionId, facultyId, subjectId, batchYear) {
  return prisma.facultyAssignment.findFirst({
    where: {
      sessionId,
      facultyId,
      subjectId,
      batchYear,
    },

    select: { id: true },
  });
}

/**
 * Check if a subject+batch has ANY faculty assigned in this session.
 *
 * Used when:
 *   - Creating ResultPublication: ensures every subject has a faculty assigned
 *   - Offering validation: warns HOD if offering has no faculty yet
 *
 * @param {number} sessionId      - Session ID
 * @param {number} subjectId      - Subject ID
 * @param {number} batchYear      - Batch year
 * @returns {Promise<Object|null>}
 */
async function findAssignmentForSubject(sessionId, subjectId, batchYear) {
  return prisma.facultyAssignment.findFirst({
    where: {
      sessionId,
      subjectId,
      batchYear,
    },

    select: {
      id: true,
      facultyId: true,
      faculty: {
        select: {
          user: { select: { id: true, name: true } },
        },
      },
    },
  });
}

/**
 * Update an assignment (change faculty or semester details).
 *
 * HOD may need to reassign a subject mid-session
 * (e.g. faculty goes on leave).
 *
 * @param {number} assignmentId - Assignment primary key
 * @param {number} schoolId     - School isolation
 * @param {Object} data         - Fields to update
 * @returns {Promise<{count: number}>}
 */
async function updateAssignment(assignmentId, schoolId, data) {
  return prisma.facultyAssignment.updateMany({
    where: {
      id: assignmentId,
      schoolId,
    },

    data,
  });
}

/**
 * Delete an assignment.
 *
 * Hard delete — assignments are configuration, not student records.
 * Removing an assignment means that faculty member can no longer
 * submit marks for that subject.
 *
 * @param {number} assignmentId - Assignment primary key
 * @param {number} schoolId     - School isolation
 * @returns {Promise<{count: number}>}
 */
async function deleteAssignment(assignmentId, schoolId) {
  return prisma.facultyAssignment.deleteMany({
    where: {
      id: assignmentId,
      schoolId,
    },
  });
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  createAssignment,
  findAllBySession,
  findByFaculty,
  findById,
  findDuplicate,
  findAssignmentForSubject,
  updateAssignment,
  deleteAssignment,
};
