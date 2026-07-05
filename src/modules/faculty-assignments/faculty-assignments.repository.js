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
async function findDuplicate(schoolId, sessionId, facultyId, subjectId, batchYear) {
  return prisma.facultyAssignment.findFirst({
    where: {
      schoolId,    // added — enforces tenant isolation
      sessionId,
      facultyId,
      subjectId,
      batchYear,
    },
    select: { id: true },
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
// STUDENT-FACING QUERY
// =============================================================================

/**
 * findForStudentSubject
 *
 * Looks up the faculty assignment for a specific subject,
 * scoped to an EXACT combination of session + batch + semester.
 *
 * Why so many filters?
 *   The same subject (e.g. "DBMS") can be taught by DIFFERENT faculty in
 *   different sessions or for different batches/semesters.
 *   Without all five filters, we could accidentally return Dr. A (who taught
 *   Batch 2021 Sem 3) when a Batch 2023 student asks about their teacher.
 *
 * The caller (service layer) derives sessionId, batchYear, and semesterNumber
 * from the student's own active registration — so a student can NEVER query
 * outside their own cohort.
 *
 * @param {number} schoolId       - School isolation (always required)
 * @param {number} sessionId      - The student's current session
 * @param {number} subjectId      - The subject the student is asking about
 * @param {number} batchYear      - The student's batch year
 * @param {number} semesterNumber - The student's current semester
 * @returns {Promise<Object|null>}
 */
async function findForStudentSubject(schoolId, sessionId, subjectId, batchYear, semesterNumber) {
  return prisma.facultyAssignment.findFirst({
    where: {
      schoolId,
      sessionId,
      subjectId,
      batchYear,
      semesterNumber,
    },

    select: {
      id: true,
      faculty: {
        select: {
          id: true,
          designation: true,
          officeLocation: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              bio: true,
              profilePhotoUrl: true,
              linkedinUrl: true,
              githubUrl: true,
              portfolioUrl: true,
            },
          },
        },
      },
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
  updateAssignment,
  deleteAssignment,
  findForStudentSubject,
};
