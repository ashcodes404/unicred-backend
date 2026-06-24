// =============================================================================
// COURSES REPOSITORY
// =============================================================================
//
// "Courses" in this system = Subjects.
// The schema table is "subjects" but the API uses "courses" because
// HODs and students refer to them as courses (following the project brief).
//
// Two things live in this repository:
//
//   1. Subject (Course) management
//      The actual course definition — code, name, credits, type.
//      Created and managed by HOD.
//      Scoped by schoolId + departmentId.
//
//   2. Course Offerings
//      Defines WHICH courses are offered in a specific session for a batch.
//      Example: EE301 is offered in "2026-27 Odd" for Batch 2024, Semester 3.
//      Only offered courses appear in faculty assignments, timetables,
//      student dashboard, and result management.
//
// =============================================================================

const prisma = require("../../config/db");

// =============================================================================
// SUBJECTS (COURSES)
// =============================================================================

/**
 * Create a new subject/course.
 *
 * @param {Object} data - { schoolId, departmentId, courseCode, name, credits,
 *                          subjectType, passingMarks, totalMarks }
 * @returns {Promise<Object>} - Created subject
 */
async function createSubject(data) {
  return prisma.subject.create({
    data,

    select: {
      id: true,
      courseCode: true,
      name: true,
      credits: true,
      subjectType: true,
      passingMarks: true,
      totalMarks: true,
      isActive: true,
      departmentId: true,
      createdAt: true,
    },
  });
}

/**
 * Find all active subjects for a department.
 *
 * Why filter isActive = true by default?
 *   Deactivated courses are hidden from all normal views.
 *   HOD explicitly asks for deactivated courses when managing them.
 *
 * @param {number} schoolId      - School isolation
 * @param {number} departmentId  - Department isolation
 * @param {boolean} includeInactive - If true, returns all including deactivated
 * @returns {Promise<Array>}
 */
async function findAllByDepartment(schoolId, departmentId, includeInactive = false) {
  return prisma.subject.findMany({
    where: {
      schoolId,
      departmentId,
      ...(includeInactive ? {} : { isActive: true }),
    },

    select: {
      id: true,
      courseCode: true,
      name: true,
      credits: true,
      subjectType: true,
      passingMarks: true,
      totalMarks: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,

      // Include syllabus existence flag
      syllabus: {
        select: { id: true, version: true, updatedAt: true },
      },
    },

    orderBy: { courseCode: "asc" },
  });
}

/**
 * Find a single subject by ID.
 *
 * Returns full details including syllabus if it exists.
 *
 * @param {number} subjectId     - Subject primary key
 * @param {number} schoolId      - School isolation
 * @param {number} departmentId  - Department isolation
 * @returns {Promise<Object|null>}
 */
async function findById(subjectId, schoolId, departmentId) {
  return prisma.subject.findFirst({
    where: {
      id: subjectId,
      schoolId,
      departmentId,
    },

    select: {
      id: true,
      courseCode: true,
      name: true,
      credits: true,
      subjectType: true,
      passingMarks: true,
      totalMarks: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,

      syllabus: {
        select: {
          id: true,
          content: true,
          learningOutcomes: true,
          syllabusUrl: true,
          version: true,
          updatedAt: true,
        },
      },

      department: {
        select: { id: true, name: true },
      },
    },
  });
}

/**
 * Find subject by ID with school isolation only (no dept filter).
 *
 * Used when faculty or students fetch subject details —
 * they don't own a department but need the full subject info.
 *
 * @param {number} subjectId - Subject primary key
 * @param {number} schoolId  - School isolation
 * @returns {Promise<Object|null>}
 */
async function findByIdForAnyRole(subjectId, schoolId) {
  return prisma.subject.findFirst({
    where: {
      id: subjectId,
      schoolId,
      isActive: true,
    },

    select: {
      id: true,
      courseCode: true,
      name: true,
      credits: true,
      subjectType: true,
      passingMarks: true,
      totalMarks: true,
      departmentId: true,

      syllabus: {
        select: {
          id: true,
          content: true,
          learningOutcomes: true,
          syllabusUrl: true,
          version: true,
          updatedAt: true,
        },
      },
    },
  });
}

/**
 * Check if a courseCode already exists in a department.
 *
 * Used during create/update to enforce courseCode uniqueness per department.
 *
 * Why unique per department and not globally?
 *   EE dept: "MATH101" = Engineering Mathematics
 *   CS dept: "MATH101" = Discrete Mathematics
 *   Same code, different departments, different courses — both valid.
 *
 * @param {number} departmentId  - Department to check within
 * @param {string} courseCode    - Code to check
 * @param {number} [excludeId]   - Subject ID to exclude (used during update)
 * @returns {Promise<Object|null>} - Existing subject if code taken, null if available
 */
async function findByCourseCode(departmentId, courseCode, excludeId = null) {
  return prisma.subject.findFirst({
    where: {
      departmentId,
      courseCode,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },

    select: { id: true, courseCode: true },
  });
}

/**
 * Update a subject.
 *
 * @param {number} subjectId     - Subject primary key
 * @param {number} schoolId      - School isolation
 * @param {number} departmentId  - Department isolation
 * @param {Object} data          - Fields to update
 * @returns {Promise<{count: number}>}
 */
async function updateSubject(subjectId, schoolId, departmentId, data) {
  return prisma.subject.updateMany({
    where: {
      id: subjectId,
      schoolId,
      departmentId,
    },

    data,
  });
}

/**
 * Deactivate a subject (soft disable).
 *
 * Sets isActive = false.
 * Deactivated subjects are hidden from:
 *   - Faculty assignment UI
 *   - Student dashboard
 *   - Timetable creation
 *   - Result management
 *
 * Why not hard delete?
 *   Historical marks and CGPA records reference this subject.
 *   Deleting it would break those records.
 *
 * @param {number} subjectId     - Subject primary key
 * @param {number} schoolId      - School isolation
 * @param {number} departmentId  - Department isolation
 * @returns {Promise<{count: number}>}
 */
async function deactivateSubject(subjectId, schoolId, departmentId) {
  return prisma.subject.updateMany({
    where: {
      id: subjectId,
      schoolId,
      departmentId,
    },

    data: { isActive: false },
  });
}

// =============================================================================
// COURSE OFFERINGS
// =============================================================================
//
// A CourseOffering says:
//   "Subject EE301 is offered in Session X for Batch 2024 in Semester 3."
//
// Only offered courses appear in faculty assignments, timetables,
// result management, and student subject lists.
//

/**
 * Create a course offering.
 *
 * @param {Object} data - { schoolId, sessionId, subjectId, departmentId,
 *                          semesterNumber, batchYear }
 * @returns {Promise<Object>}
 */
async function createOffering(data) {
  return prisma.courseOffering.create({
    data,

    select: {
      id: true,
      sessionId: true,
      subjectId: true,
      semesterNumber: true,
      batchYear: true,
      isActive: true,
      createdAt: true,

      subject: {
        select: { id: true, courseCode: true, name: true, credits: true },
      },

      session: {
        select: { id: true, name: true },
      },
    },
  });
}

/**
 * Find all offerings for a session.
 *
 * HOD views this to see what's offered in the current session.
 * Can optionally filter by semesterNumber or batchYear.
 *
 * @param {number} schoolId       - School isolation
 * @param {number} sessionId      - Which session
 * @param {Object} filters        - Optional: { semesterNumber, batchYear }
 * @returns {Promise<Array>}
 */
async function findOfferingsBySession(schoolId, sessionId, filters = {}) {
  const { semesterNumber, batchYear } = filters;

  return prisma.courseOffering.findMany({
    where: {
      schoolId,
      sessionId,
      isActive: true,
      ...(semesterNumber ? { semesterNumber: parseInt(semesterNumber) } : {}),
      ...(batchYear      ? { batchYear:      parseInt(batchYear) }      : {}),
    },

    select: {
      id: true,
      semesterNumber: true,
      batchYear: true,
      isActive: true,

      subject: {
        select: {
          id: true,
          courseCode: true,
          name: true,
          credits: true,
          subjectType: true,
          passingMarks: true,
          totalMarks: true,
        },
      },
    },

    orderBy: [
      { semesterNumber: "asc" },
      { subject: { courseCode: "asc" } },
    ],
  });
}

/**
 * Find a single offering by ID.
 *
 * @param {number} offeringId - Offering primary key
 * @param {number} schoolId   - School isolation
 * @returns {Promise<Object|null>}
 */
async function findOfferingById(offeringId, schoolId) {
  return prisma.courseOffering.findFirst({
    where: {
      id: offeringId,
      schoolId,
    },

    select: {
      id: true,
      sessionId: true,
      subjectId: true,
      semesterNumber: true,
      batchYear: true,
      isActive: true,

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
 * Check if an offering already exists for this session+subject+batch.
 *
 * Prevents duplicate offerings.
 * Used during creation to enforce the @@unique constraint at service level
 * (gives a better error message than a raw Prisma unique constraint error).
 *
 * @param {number} sessionId      - Session ID
 * @param {number} subjectId      - Subject ID
 * @param {number} batchYear      - Batch year
 * @param {number} [excludeId]    - Offering ID to exclude (for updates)
 * @returns {Promise<Object|null>}
 */
async function findDuplicateOffering(sessionId, subjectId, batchYear, excludeId = null) {
  return prisma.courseOffering.findFirst({
    where: {
      sessionId,
      subjectId,
      batchYear,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },

    select: { id: true },
  });
}

/**
 * Remove a course offering.
 *
 * Hard delete — offerings are configuration data, not student records.
 * A removed offering means the subject is no longer offered this session.
 * Historical records (marks, attendance) are unaffected because they
 * reference subjectId directly, not offeringId.
 *
 * @param {number} offeringId - Offering primary key
 * @param {number} schoolId   - School isolation
 * @returns {Promise<{count: number}>}
 */
async function deleteOffering(offeringId, schoolId) {
  return prisma.courseOffering.deleteMany({
    where: {
      id: offeringId,
      schoolId,
    },
  });
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // ── Subjects ───────────────────────────────────────────────────────────────
  createSubject,
  findAllByDepartment,
  findById,
  findByIdForAnyRole,
  findByCourseCode,
  updateSubject,
  deactivateSubject,

  // ── Offerings ──────────────────────────────────────────────────────────────
  createOffering,
  findOfferingsBySession,
  findOfferingById,
  findDuplicateOffering,
  deleteOffering,
};
