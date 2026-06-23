const prisma = require("../../config/db");

/**
 * STUDENT REPOSITORY
 *
 * Responsibilities:
 * - Execute Prisma queries
 * - Return raw database data
 * - NO business logic
 * - NO authorization logic
 * - NO HTTP logic
 *
 * Think of repository as:
 *
 * Service:
 * "Get all students for school 5"
 *
 * Repository:
 * "Okay, I'll run the SQL/Prisma query"
 */

/**
 * Get all students belonging to a school.
 *
 * Multi-tenancy enforcement begins here.
 *
 * VERY IMPORTANT:
 * Never query students without schoolId.
 *
 * Wrong:
 * prisma.student.findMany()
 *
 * Correct:
 * prisma.student.findMany({
 *   where: { schoolId }
 * })
 */
async function findAllBySchool(schoolId) {
  return prisma.student.findMany({
    where: {
      schoolId,
      deletedAt: null,
    },

    include: {
      user: true,
      department: true,
    },
  });
}

/**
 * Find a specific student by id
 * while enforcing school isolation.
 *
 * Student from School A
 * must never see Student from School B.
 */
async function findById(studentId, schoolId) {
  return prisma.student.findFirst({
    where: {
      id: studentId,
      schoolId,
      deletedAt: null,
    },

    include: {
      user: true,
      department: true,
    },
  });
}

/**
 * Create student record.
 *
 * schoolId must come from JWT
 * not from frontend request body.
 */
async function createStudent(data) {
  return prisma.student.create({
    data,
  });
}

/**
 * Update student.
 *
 * School isolation enforced.
 */
async function updateStudent(
  studentId,
  schoolId,
  updateData
) {
  return prisma.student.updateMany({
    where: {
      id: studentId,
      schoolId,
      deletedAt: null,
    },

    data: updateData,
  });
}

/**
 * Soft delete student.
 */
async function deleteStudent(
  studentId,
  schoolId
) {
  return prisma.student.updateMany({
    where: {
      id: studentId,
      schoolId,
      deletedAt: null,
    },

    data: {
      deletedAt: new Date(),
    },
  });
}

/**
 * =====================================================
 * AUTHORIZATION SUPPORT QUERIES
 * =====================================================
 *
 * These functions are NOT CRUD operations.
 *
 * They exist to help the Service Layer perform
 * authorization checks.
 *
 * Example:
 *
 * Student tries:
 *
 * GET /students/15
 *
 * Controller:
 *    receives request
 *
 * Service:
 *    must determine:
 *    "Is this student allowed to view record #15?"
 *
 * To answer that question,
 * service needs additional database lookups.
 *
 * Repository provides those lookups.
 */

/**
 * Find student record by USER ID.
 *
 * Why do we need this?
 *
 * JWT payload contains:
 *
 * req.user = {
 *   userId,
 *   role,
 *   schoolId
 * }
 *
 * Notice:
 *
 * JWT contains userId
 * NOT studentId
 *
 * Example:
 *
 * User table:
 * id = 25
 *
 * Student table:
 * id = 10
 * userId = 25
 *
 * When a student logs in,
 * JWT contains:
 *
 * userId = 25
 *
 * Service layer can call:
 *
 * findByUserId(25)
 *
 * to discover:
 *
 * studentId = 10
 *
 * Later used for:
 *
 * Student Self Access Authorization
 */
async function findByUserId(userId) {
  return prisma.student.findFirst({
    where: {
      userId,
      deletedAt: null,
    },

    include: {
      user: true,
      department: true,
    },
  });
}

/**
 * =====================================================
 * FIND STUDENT BY ROLL NUMBER
 * =====================================================
 *
 * Used to prevent
 * duplicate roll numbers.
 */
async function findBySchoolAndRollNo(
  schoolId,
  rollNo
) {
  return prisma.student.findFirst({
    where: {
      schoolId,
      rollNo,
      deletedAt: null,
    },
  });
}

/**
 * Find student along with department information.
 *
 * Why?
 *
 * Future HOD authorization:
 *
 * HOD (CSE)
 *
 * wants to update:
 *
 * Student #15
 *
 * Service must determine:
 *
 * student.departmentId
 *
 * This query returns:
 *
 * Student
 * + Department
 *
 * in a single database call.
 *
 * Example response:
 *
 * {
 *   id: 15,
 *   departmentId: 2,
 *
 *   department: {
 *     id: 2,
 *     name: "CSE"
 *   }
 * }
 */
async function findStudentWithDepartment(
  studentId,
  schoolId
) {
  return prisma.student.findFirst({
    where: {
      id: studentId,
      schoolId,
      deletedAt: null,
    },

    include: {
      department: true,
      user: true,
    },
  });
}

/**
 * Find only student's department.
 *
 * This is a lightweight query.
 *
 * Useful when service only needs:
 *
 * departmentId
 *
 * and not the full student record.
 *
 * Prisma "select" fetches only
 * specified fields.
 *
 * This improves performance because
 * unnecessary columns are not loaded.
 */
async function findStudentDepartment(
  studentId,
  schoolId
) {
  return prisma.student.findFirst({
    where: {
      id: studentId,
      schoolId,
      deletedAt: null,
    },

    select: {
      departmentId: true,
    },
  });
}


/**
 * =====================================================
 * RESULT QUERIES
 * =====================================================
 *
 * These repository functions are responsible for
 * fetching academic results for students.
 *
 * IMPORTANT BUSINESS RULES:
 *
 * Students must ONLY see:
 *
 * 1. Published results
 * 2. Active (non-invalidated) results
 *
 * Students must NEVER see:
 *
 * - Draft results
 * - Under review results
 * - Frozen results
 * - Invalidated results
 *
 * Why invalidated?
 *
 * Example:
 *
 * Subject: DBMS
 *
 * Attempt #1:
 * Marks = 32 (FAIL)
 *
 * Reappear Approved
 *
 * Attempt #1 becomes invalidated
 *
 * Attempt #2:
 * Marks = 68
 *
 * Student should only see
 * the active result.
 */


/**
 * Get all ACTIVE and PUBLISHED subject marks
 * for a student.
 *
 * This function is used by:
 *
 * GET /students/results
 *
 * Multi-tenancy:
 * - schoolId enforced
 *
 * Visibility:
 * - publication status MUST be published
 *
 * Reappear:
 * - invalidated marks are hidden
 */
async function findSubjectMarksByStudentId(
  studentId,
  schoolId
) {
  return prisma.subjectMark.findMany({
    where: {
      studentId,
      schoolId,

      /**
       * Only active marks.
       *
       * If a student gives a reappear exam,
       * old marks become invalidated.
       */
      invalidatedAt: null,

      /**
       * Only published results
       * are visible to students.
       */
      publication: {
        status: "PUBLISHED",
      },
    },

    include: {
      /**
       * Subject information.
       *
       * Needed by frontend:
       *
       * DBMS
       * Operating Systems
       * CN
       */
      subject: {
        select: {
          id: true,
          name: true,
          courseCode: true,
          passingMarks: true,
          totalMarks: true,
        },
      },

      /**
       * Publication metadata.
       *
       * Needed for:
       *
       * Session
       * Semester
       * Batch
       */
      publication: {
        select: {
          id: true,
          sessionId: true,
          semesterNumber: true,
          batchYear: true,
          publishedAt: true,
        },
      },
    },

    orderBy: {
      createdAt: "desc",
    },
  });
}

/**
 * Lightweight result query.
 *
 * Used internally by services that only need
 * marks data.
 *
 * Faster than loading subject/publication relations.
 */
async function findActiveMarksForCgpa(
  studentId,
  schoolId
) {
  return prisma.subjectMark.findMany({
    where: {
      studentId,
      schoolId,
      invalidatedAt: null,

      publication: {
        status: "PUBLISHED",
      },
    },

    select: {
      id: true,
      marksObtained: true,
      subjectId: true,
    },
  });
}


module.exports = {
  findAllBySchool,
  findById,
  createStudent,
  updateStudent,
  deleteStudent,

   // Authorization helpers
  findByUserId,
  findBySchoolAndRollNo,
  findStudentWithDepartment,
  findStudentDepartment,

  // Result Queries
  findSubjectMarksByStudentId,
  findActiveMarksForCgpa,
};