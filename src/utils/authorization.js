/**
 * AUTHORIZATION HELPER FUNCTIONS
 *
 * Purpose:
 * Keep permission logic out of controllers.
 *
 * Bad:
 *
 * if (...) {}
 * if (...) {}
 * if (...) {}
 *
 * repeated everywhere
 *
 * Good:
 *
 * if (!isSameSchool(...))
 *
 * Reusable.
 */

/**
 * Checks whether two records belong
 * to the same school.
 */
function isSameSchool(userSchoolId, resourceSchoolId) {
  return userSchoolId === resourceSchoolId;
}

/**
 * Checks whether two records belong
 * to the same department.
 */
function isSameDepartment(
  userDepartmentId,
  resourceDepartmentId
) {
  return userDepartmentId === resourceDepartmentId;
}

/**
 * Convenience helper.
 */
function isAdmin(role) {
  return role === "admin";
}

/**
 * Convenience helper.
 */
function isFaculty(role) {
  return role === "faculty";
}

/**
 * Convenience helper.
 */
function isHod(role) {
  return role === "hod";
}

/**
 * Convenience helper.
 */
function isStudent(role) {
  return role === "student";
}

/**
 * =====================================================
 * STUDENT RESOURCE AUTHORIZATION
 * =====================================================
 *
 * Purpose:
 *
 * Decide whether the current user
 * can access a specific student record.
 *
 * IMPORTANT:
 *
 * This function DOES NOT:
 *
 * - Query database
 * - Read req.user
 * - Throw errors
 * - Send responses
 *
 * It only returns:
 *
 * true
 * or
 * false
 *
 * Service layer decides what to do
 * with the result.
 *
 * Example:
 *
 * if (!canAccessStudent(...)) {
 *   throw new Error("Forbidden");
 * }
 */

/**
 * Determines whether a user
 * may access a student resource.
 *
 * Parameters:
 *
 * currentUser
 *    Logged-in user from JWT
 *
 * student
 *    Student record fetched from DB
 *
 * facultyInfo
 *    Faculty record (if current user
 *    is faculty)
 *
 * hodDepartment
 *    Department managed by HOD
 *
 * Returns:
 *
 * true  -> access allowed
 * false -> access denied
 */
function canAccessStudent(
  currentUser,
  student,
  facultyInfo = null,
  hodDepartment = null
) {
  /**
   * ---------------------------------------------------
   * ADMIN
   * ---------------------------------------------------
   *
   * Admin can access everything
   * inside their school.
   *
   * School isolation has already
   * been enforced by repository.
   */
  if (isAdmin(currentUser.role)) {
    return true;
  }

  /**
   * ---------------------------------------------------
   * STUDENT
   * ---------------------------------------------------
   *
   * Student may only access
   * their own record.
   *
   * Student.userId references
   * User.id in schema.
   *
   * NOTE: the JWT payload only contains `userId`,
   * not `id` — using currentUser.id here was a bug
   * (always undefined, silently failing this check).
   */
  if (isStudent(currentUser.role)) {
    return student.userId === currentUser.userId;
  }

  /**
   * ---------------------------------------------------
   * FACULTY
   * ---------------------------------------------------
   *
   * Faculty may access students
   * belonging to the same department.
   */
  if (isFaculty(currentUser.role)) {
    if (!facultyInfo) {
      return false;
    }

    return (
      facultyInfo.departmentId ===
      student.departmentId
    );
  }

  /**
   * ---------------------------------------------------
   * HOD
   * ---------------------------------------------------
   *
   * HOD may access students
   * belonging to department
   * managed by the HOD.
   */
  if (isHod(currentUser.role)) {
    if (!hodDepartment) {
      return false;
    }

    return (
      hodDepartment.id ===
      student.departmentId
    );
  }

  /**
   * Unknown role
   */
  return false;
}

module.exports = {
  isSameSchool,
  isSameDepartment,
  isAdmin,
  isFaculty,
  isHod,
  isStudent,

  canAccessStudent,
};
