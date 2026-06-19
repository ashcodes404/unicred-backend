const departmentRepository = require(
  "./departments.repository"
);

const userRepository = require(
  "../users/users.repository"
);

const { isHod } = require(
  "../../utils/authorization"
);

/**
 * =====================================================
 * DEPARTMENT SERVICE
 * =====================================================
 *
 *
 * Service receives clean data
 * from controller.
 *
 * Example:
 *
 * Controller:
 *
 * createDepartment(
 *   req.body.name,
 *   req.schoolId
 * )
 *
 * Service:
 *
 * createDepartment(
 *   name,
 *   schoolId
 * )
 */

/**
 * =====================================================
 * GET ALL DEPARTMENTS
 * =====================================================
 *
 * Returns all departments
 * belonging to current school.
 */
async function getAllDepartments(
  schoolId
) {
  return departmentRepository.findAllBySchool(
    schoolId
  );
}

/**
 * =====================================================
 * GET DEPARTMENT BY ID
 * =====================================================
 *
 * Steps:
 *
 * 1. Fetch department
 * 2. Check existence
 * 3. Return department
 */
async function getDepartmentById(
  departmentId,
  schoolId
) {
  const department =
    await departmentRepository.findById(
      departmentId,
      schoolId
    );

  if (!department) {
    throw new Error(
      "Department not found"
    );
  }

  return department;
}

/**
 * =====================================================
 * CREATE DEPARTMENT
 * =====================================================
 *
 * Business Rules:
 *
 * 1. Department name required
 * 2. Department must be unique
 *    inside school
 * 3. Create department
 *
 * Example:
 *
 * School A:
 *
 * CSE
 * ECE
 *
 * Trying to create:
 *
 * CSE
 *
 * Result:
 *
 * Error
 */
async function createDepartment(
  name,
  schoolId
) {
  /**
   * Trim spaces.
   *
   * Example:
   *
   * "  CSE  "
   *
   * becomes
   *
   * "CSE"
   */
  const normalizedName =
    name.trim();

  /**
   * Check duplicate department.
   */
  const existingDepartment =
    await departmentRepository.findByName(
      normalizedName,
      schoolId
    );

  if (existingDepartment) {
    throw new Error(
      "Department already exists"
    );
  }

  /**
   * Create department.
   */
  return departmentRepository.createDepartment({
    schoolId,
    name: normalizedName,
  });
}

/**
 * =====================================================
 * UPDATE DEPARTMENT
 * =====================================================
 *
 * Steps:
 *
 * 1. Verify department exists
 * 2. Verify new name not duplicated
 * 3. Verify hodUserId (if provided) belongs to this
 *    school and actually holds the "hod" role
 * 4. Update only whitelisted fields
 *
 * BUGFIX: previously passed the raw request body
 * straight into the repository update — an admin could
 * include schoolId in the body and move a department to
 * a different school, or set hodUserId to any arbitrary
 * id with no validation at all. Now whitelisted to
 * `name` and `hodUserId`, and hodUserId is verified.
 *
 * hodUserId can be explicitly set to null to unassign
 * the current HOD.
 */
async function updateDepartment(
  departmentId,
  schoolId,
  updateData
) {
  const existingDepartment =
    await departmentRepository.findById(
      departmentId,
      schoolId
    );

  if (!existingDepartment) {
    throw new Error(
      "Department not found"
    );
  }

  const { name, hodUserId } = updateData;

  const whitelisted = {};

  /**
   * Name change — check duplicates.
   */
  if (name !== undefined) {
    const normalizedName = name.trim();

    const duplicateDepartment =
      await departmentRepository.findByName(
        normalizedName,
        schoolId
      );

    if (
      duplicateDepartment &&
      duplicateDepartment.id !== departmentId
    ) {
      throw new Error(
        "Department already exists"
      );
    }

    whitelisted.name = normalizedName;
  }

  /**
   * HOD reassignment — validate the target user.
   */
  if (hodUserId !== undefined) {
    if (hodUserId === null) {
      // Explicit unassignment.
      whitelisted.hodUserId = null;
    } else {
      const hodUser = await userRepository.findById(
        hodUserId,
        schoolId
      );

      if (!hodUser) {
        throw new Error(
          "HOD user not found in this school"
        );
      }

      if (!isHod(hodUser.role)) {
        throw new Error(
          "Assigned HOD must have the hod role"
        );
      }

      whitelisted.hodUserId = hodUserId;
    }
  }

  await departmentRepository.updateDepartment(
    departmentId,
    schoolId,
    whitelisted
  );

  return departmentRepository.findById(
    departmentId,
    schoolId
  );
}

/**
 * =====================================================
 * DELETE DEPARTMENT
 * =====================================================
 *
 * Soft delete.
 *
 * Steps:
 *
 * 1. Verify department exists
 * 2. Soft delete
 */
async function deleteDepartment(
  departmentId,
  schoolId
) {
  const existingDepartment =
    await departmentRepository.findById(
      departmentId,
      schoolId
    );

  if (!existingDepartment) {
    throw new Error(
      "Department not found"
    );
  }

  await departmentRepository.deleteDepartment(
    departmentId,
    schoolId
  );

  return {
    success: true,
    message:
      "Department deleted successfully",
  };
}

/**
 * =====================================================
 * EXPORTS
 * =====================================================
 */
module.exports = {
  getAllDepartments,
  getDepartmentById,
  createDepartment,
  updateDepartment,
  deleteDepartment,
};