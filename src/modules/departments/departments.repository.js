const prisma = require("../../config/db");

/**
 * =====================================================
 * DEPARTMENT REPOSITORY
 * =====================================================
 *
 * WHAT IS A REPOSITORY?
 *
 * Repository is the ONLY layer
 * that talks to Prisma.
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
 *
 *
 * "How do I get data from database?"
 */

/**
 * =====================================================
 * GET ALL DEPARTMENTS
 * =====================================================
 *
 * Purpose:
 *
 * Return all departments
 * belonging to a specific school.
 *
 * Example:
 *
 * School #1
 *   ├── CSE
 *   ├── ECE
 *   └── EE
 *
 * Parameters:
 *
 * schoolId
 *
 * Comes from:
 *
 * JWT
 * ↓
 * req.user.schoolId
 * ↓
 * Controller
 * ↓
 * Service
 * ↓
 * Repository
 *
 * Repository only receives
 * the schoolId value.
 */
async function findAllBySchool(schoolId) {
  return prisma.department.findMany({
    where: {
      schoolId,
      deletedAt: null,
    },

    orderBy: {
      name: "asc",
    },
  });
}

/**
 * =====================================================
 * FIND DEPARTMENT BY ID
 * =====================================================
 *
 * Purpose:
 *
 * Return one department.
 *
 * Multi-tenancy protection:
 *
 * School A should never
 * access School B department.
 *
 * Therefore:
 *
 * departmentId alone
 * is NOT enough.
 *
 * We also check:
 *
 * schoolId
 */
async function findById(
  departmentId,
  schoolId
) {
  return prisma.department.findFirst({
    where: {
      id: departmentId,
      schoolId,
      deletedAt: null,
    },

    include: {
      hod: true,
    },
  });
}

/**
 * =====================================================
 * FIND DEPARTMENT BY NAME
 * =====================================================
 *
 * Purpose:
 *
 * Used before creation.
 *
 * Example:
 *
 * Admin tries to create:
 *
 * "CSE"
 *
 * Service first checks:
 *
 * Does "CSE" already exist
 * in this school?
 *
 * If yes:
 *
 * throw error
 *
 * This prevents duplicates.
 */
async function findByName(
  name,
  schoolId
) {
  return prisma.department.findFirst({
    where: {
      name,
      schoolId,
      deletedAt: null,
    },
  });
}

/**
 * =====================================================
 * CREATE DEPARTMENT
 * =====================================================
 *
 * Purpose:
 *
 * Insert a new department.
 *
 * Example:
 *
 * {
 *   schoolId: 1,
 *   name: "CSE"
 * }
 *
 * Repository does NOT validate.
 *
 * Validation happens
 * in Service layer.
 */
async function createDepartment(data) {
  return prisma.department.create({
    data,
  });
}

/**
 * =====================================================
 * UPDATE DEPARTMENT
 * =====================================================
 *
 * Purpose:
 *
 * Update department details.
 *
 * Example:
 *
 * Old:
 * CSE
 *
 * New:
 * Computer Science
 *
 * Multi-tenancy:
 *
 * Only update department
 * belonging to current school.
 */
async function updateDepartment(
  departmentId,
  schoolId,
  updateData
) {
  return prisma.department.updateMany({
    where: {
      id: departmentId,
      schoolId,
      deletedAt: null,
    },

    data: updateData,
  });
}

/**
 * =====================================================
 * SOFT DELETE DEPARTMENT
 * =====================================================
 *
 * Why Soft Delete?
 *
 * Imagine:
 *
 * Department = CSE
 *
 * Students exist:
 *
 * Student A
 * Student B
 *
 * Faculty exist:
 *
 * Professor X
 *
 * If we hard delete:
 *
 * Department disappears.
 *
 * Relationships break.
 *
 * Instead:
 *
 * deletedAt = current time
 *
 * Department becomes hidden
 * but data remains safe.
 */
async function deleteDepartment(
  departmentId,
  schoolId
) {
  return prisma.department.updateMany({
    where: {
      id: departmentId,
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
 * EXPORTS
 * =====================================================
 *
 * Service layer imports
 * these functions.
 *
 * Example:
 *
 * const departmentRepository =
 * require("./departments.repository");
 */
module.exports = {
  findAllBySchool,
  findById,
  findByName,
  createDepartment,
  updateDepartment,
  deleteDepartment,
};