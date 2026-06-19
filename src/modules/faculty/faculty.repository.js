const prisma = require("../../config/db");

/**
 * =====================================================
 * FACULTY REPOSITORY
 * =====================================================
 *
 * Responsibilities:
 *
 * - Execute Prisma queries
 * - Return raw database data
 * - Enforce school-level filtering
 *
 * Must NOT:
 *
 * - Read req.body
 * - Read req.params
 * - Read req.user
 * - Perform authorization checks
 * - Send HTTP responses
 *
 * Repository only talks to database.
 *
 * Request Flow:
 *
 * Route
 *   ↓
 * Controller
 *   ↓
 * Service
 *   ↓
 * Repository
 *   ↓
 * Prisma
 *   ↓
 * MySQL
 */

/**
 * =====================================================
 * CRUD QUERIES
 * =====================================================
 */

/**
 * Get all faculty members belonging to a specific school.
 *
 * Directory-style listing — every role (admin, hod, faculty,
 * student) is allowed to call this, enforced at the route
 * level. School isolation is enforced here.
 *
 * departmentId is OPTIONAL.
 *
 * If provided, narrows the list to a single department
 * (e.g. "show me CSE faculty").
 *
 * If omitted, returns every faculty member in the school,
 * ordered by department so the frontend can group them
 * easily.
 */
async function findAllBySchool(schoolId, departmentId) {
  return prisma.faculty.findMany({
    where: {
      schoolId,
      deletedAt: null,
      ...(departmentId && { departmentId }),
    },

    include: {
      user: true,
      department: true,
    },

    orderBy: {
      department: {
        name: "asc",
      },
    },
  });
}

/**
 * Find faculty by ID.
 *
 * Only returns faculty
 * belonging to the current school.
 *
 * Prevents:
 *
 * School A
 * accessing
 * School B faculty.
 */
async function findById(facultyId, schoolId) {
  return prisma.faculty.findFirst({
    where: {
      id: facultyId,
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
 * Create faculty record.
 *
 * IMPORTANT:
 *
 * schoolId must come
 * from JWT in service layer.
 *
 * Never trust frontend
 * schoolId values.
 */
async function createFaculty(data) {
  return prisma.faculty.create({
    data,
  });
}

/**
 * Update faculty record.
 *
 * School isolation enforced.
 */
async function updateFaculty(
  facultyId,
  schoolId,
  updateData
) {
  return prisma.faculty.updateMany({
    where: {
      id: facultyId,
      schoolId,
      deletedAt: null,
    },

    data: updateData,
  });
}

/**
 * Soft delete faculty.
 *
 * We do NOT remove row.
 *
 * Instead:
 *
 * deletedAt = current time
 *
 * Benefits:
 *
 * - Recoverable
 * - Audit-friendly
 * - Historical records preserved
 */
async function deleteFaculty(
  facultyId,
  schoolId
) {
  return prisma.faculty.updateMany({
    where: {
      id: facultyId,
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
 * These queries help service layer
 * perform authorization checks.
 *
 * Repository does NOT decide
 * whether access is allowed.
 *
 * It only retrieves data.
 */

/**
 * Find faculty record
 * using User ID.
 *
 * Why?
 *
 * JWT contains:
 *
 * req.user.userId
 *
 * NOT:
 *
 * facultyId
 *
 * Example:
 *
 * User:
 * id = 25
 *
 * Faculty:
 * id = 8
 * userId = 25
 *
 * Service can call:
 *
 * findByUserId(25)
 *
 * and discover:
 *
 * Faculty #8
 */
async function findByUserId(userId) {
  return prisma.faculty.findFirst({
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
 * Find faculty together
 * with department information.
 *
 * Useful for:
 *
 * Faculty authorization
 * HOD authorization
 * Department comparisons
 *
 * Example:
 *
 * Faculty #8
 * belongs to
 * Department #2 (CSE)
 */
async function findFacultyWithDepartment(
  userId
) {
  return prisma.faculty.findFirst({
    where: {
      userId,
      deletedAt: null,
    },

    include: {
      department: true,
      user: true,
    },
  });
}

/**
 * Find department owned
 * by a HOD.
 *
 * Schema:
 *
 * Department {
 *   hodUserId
 * }
 *
 * Example:
 *
 * User #25 logs in
 *
 * We need to know:
 *
 * Which department
 * does User #25 manage?
 *
 * Returns:
 *
 * {
 *   id: 2,
 *   name: "CSE",
 *   hodUserId: 25
 * }
 */
async function findDepartmentByHodUserId(
  userId,
  schoolId
) {
  return prisma.department.findFirst({
    where: {
      hodUserId: userId,
      schoolId,
      deletedAt: null,
    },
  });
}

module.exports = {
  // CRUD
  findAllBySchool,
  findById,
  createFaculty,
  updateFaculty,
  deleteFaculty,

  // Authorization helpers
  findByUserId,
  findFacultyWithDepartment,
  findDepartmentByHodUserId,
};
