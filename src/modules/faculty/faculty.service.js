const facultyRepository = require(
  "./faculty.repository"
);

const departmentRepository = require(
  "../departments/departments.repository"
);

const userRepository = require("../users/users.repository");

const { cached, invalidate } = require("../../utils/cache");
const { parsePagination, buildPaginationMeta } = require("../../utils/pagination");

/**
 * FACULTY SERVICE
 *
 * Responsibilities:
 * - Business logic
 * - Validation
 * - Orchestration
 *
 * Never:
 * - Read req.body
 * - Read req.params
 * - Send HTTP responses
 *
 * Those belong to controller.
 *
 * =====================================================
 * AUTHORIZATION MODEL FOR THIS RESOURCE
 * =====================================================
 *
 * Faculty works like a school-wide directory:
 *
 * READS (list + single record):
 *   Open to every authenticated role in the school
 *   (admin, hod, faculty, student). Enforced entirely
 *   at the route level (requireRole) + schoolId scoping
 *   in the repository — no record-level check needed.
 *
 * WRITES (create, update, delete):
 *   Admin only. Enforced at the route level. Because
 *   admin already has full access to every record in
 *   their school, no extra ownership check is needed
 *   here either.
 *
 * SELF-EDIT:
 *   Faculty/HOD never edit their own Faculty record
 *   after profile completion. Identity fields (bio,
 *   photo, links) live on the User table and are
 *   edited through the Users module instead. The
 *   Faculty table only holds admin-managed fields
 *   (departmentId, designation).
 */

/**
 * =====================================================
 * GET ALL FACULTY
 * =====================================================
 *
 * departmentId is optional — when provided, narrows
 * the directory to one department.
 */
// query.page/query.limit are optional — only the admin's whole-school
// Faculties list page sends them. Every other caller (HOD's own-department
// picker, invite-page dropdown, dashboard stat) omits them and keeps
// getting the full list back, unchanged — see findAllBySchool's own comment.
async function getAllFaculty(schoolId, departmentId, query = {}) {
  const paginated = query.page !== undefined || query.limit !== undefined;
  if (!paginated) {
    return cached(
      `fac:${schoolId}:all:${departmentId ?? ""}`,
      null,
      () => facultyRepository.findAllBySchool(schoolId, departmentId),
      `fac:${schoolId}`
    );
  }

  const { page, limit, skip } = parsePagination(query);
  const { rows, total } = await cached(
    `fac:${schoolId}:all:${departmentId ?? ""}:${page}:${limit}`,
    null,
    () => facultyRepository.findAllBySchool(schoolId, departmentId, { skip, limit }),
    `fac:${schoolId}`
  );
  return { faculty: rows, pagination: buildPaginationMeta(page, limit, total) };
}

/**
 * =====================================================
 * GET FACULTY BY ID
 * =====================================================
 */
async function getFacultyById(facultyId, schoolId) {
  const faculty = await cached(
    `fac:${schoolId}:one:${facultyId}`,
    null,
    () => facultyRepository.findById(facultyId, schoolId),
    `fac:${schoolId}`
  );

  if (!faculty) {
    throw new Error("Faculty not found");
  }

  return faculty;
}

/**
 * =====================================================
 * CREATE FACULTY (Admin direct creation)
 * =====================================================
 *
 * Used when admin onboards a faculty/hod account
 * directly instead of the user self-completing
 * their profile.
 *
 * Expected facultyData shape:
 *
 * {
 *   userId,
 *   departmentId,
 *   designation
 * }
 *
 * schoolId comes from JWT, never from frontend.
 */
async function createFaculty(facultyData, schoolId) {
  // BUG FIX (cross-tenant IDOR): this never used to check that the target
  // user actually belongs to the admin's own school — facultyRepository's
  // findByUserId() has no schoolId filter (it's a global existence check),
  // and departmentRepository.findById() only verifies the DEPARTMENT
  // belongs to this school, not the USER. Without this check, an admin of
  // School A could pass the userId of a School B user and link them into
  // School A as faculty.
  const targetUser = await userRepository.findById(facultyData.userId, schoolId);
  if (!targetUser) {
    throw new Error("User not found in this school");
  }

  const existingFaculty =
    await facultyRepository.findByUserId(
      facultyData.userId
    );

  if (existingFaculty) {
    throw new Error(
      "Faculty profile already exists for this user"
    );
  }

  const department = await departmentRepository.findById(
    facultyData.departmentId,
    schoolId
  );

  if (!department) {
    throw new Error("Department not found");
  }

  const faculty = await facultyRepository.createFaculty({
    userId: facultyData.userId,
    schoolId,
    departmentId: facultyData.departmentId,
    designation: facultyData.designation,
  });

  await invalidate(`fac:${schoolId}`);

  return faculty;
}

/**
 * =====================================================
 * UPDATE FACULTY (Admin only)
 * =====================================================
 *
 * Field whitelist:
 *
 * Only departmentId and designation can change here.
 * Everything else (name, bio, photo, etc.) lives on
 * the User table and is out of scope for this resource.
 */
async function updateFaculty(
  facultyId,
  schoolId,
  updateData
) {
  const existingFaculty = await facultyRepository.findById(
    facultyId,
    schoolId
  );

  if (!existingFaculty) {
    throw new Error("Faculty not found");
  }

  const { departmentId, designation } = updateData;

  if (departmentId) {
    const department = await departmentRepository.findById(
      departmentId,
      schoolId
    );

    if (!department) {
      throw new Error("Department not found");
    }
  }

  await facultyRepository.updateFaculty(facultyId, schoolId, {
    ...(departmentId && { departmentId }),
    ...(designation && { designation }),
  });

  await invalidate(`fac:${schoolId}`);

  return facultyRepository.findById(facultyId, schoolId);
}

/**
 * =====================================================
 * DELETE FACULTY (Admin only)
 * =====================================================
 *
 * Soft delete.
 */
async function deleteFaculty(facultyId, schoolId) {
  const existingFaculty = await facultyRepository.findById(
    facultyId,
    schoolId
  );

  if (!existingFaculty) {
    throw new Error("Faculty not found");
  }

  await facultyRepository.deleteFaculty(facultyId, schoolId);

  await invalidate(`fac:${schoolId}`);

  return {
    success: true,
    message: "Faculty deleted successfully",
  };
}

/**
 * =====================================================
 * COMPLETE FACULTY PROFILE
 * =====================================================
 *
 * Purpose:
 *
 * Registration creates:
 *
 * User
 *
 * This endpoint creates:
 *
 * Faculty
 *
 * linked to the logged-in user.
 *
 * NOTE:
 *
 * Both "faculty" AND "hod" roles call this. An HOD
 * is still a teaching staff member with a real Faculty
 * row (department + designation) — "hod" only becomes
 * meaningful separately, when admin sets them as
 * Department.hodUserId.
 *
 * Example:
 *
 * User
 *  id = 25
 *  role = faculty
 *
 * becomes
 *
 * Faculty
 *  userId = 25
 *  departmentId = 1
 *  designation = "Assistant Professor"
 *
 * Parameters:
 *
 * currentUser
 *    Comes from JWT
 *
 * profileData
 *    Comes from req.body
 */
async function completeFacultyProfile(
  currentUser,
  profileData
) {
  /**
   * ---------------------------------------------------
   * STEP 1
   * Check whether profile already exists
   * ---------------------------------------------------
   *
   * One User
   * can only have
   * one Faculty profile.
   */
  const existingFaculty =
    await facultyRepository.findByUserId(
      currentUser.userId
    );

  if (existingFaculty) {
    throw new Error(
      "Faculty profile already exists"
    );
  }

  /**
   * ---------------------------------------------------
   * STEP 2
   * Verify department exists
   * ---------------------------------------------------
   *
   * Faculty cannot join
   * a department that
   * does not exist.
   */
  const department =
    await departmentRepository.findById(
      profileData.departmentId,
      currentUser.schoolId
    );

  if (!department) {
    throw new Error(
      "Department not found"
    );
  }

  /**
   * ---------------------------------------------------
   * STEP 3
   * Create Faculty Record
   * ---------------------------------------------------
   *
   * IMPORTANT:
   *
   * userId
   * schoolId
   *
   * come from JWT.
   *
   * Never trust frontend.
   */
  const faculty = await facultyRepository.createFaculty({
    userId: currentUser.userId,

    schoolId: currentUser.schoolId,

    departmentId:
      profileData.departmentId,

    designation:
      profileData.designation,
  });

  await invalidate(`fac:${currentUser.schoolId}`);

  return faculty;
}

module.exports = {
  getAllFaculty,
  getFacultyById,
  createFaculty,
  updateFaculty,
  deleteFaculty,
  completeFacultyProfile,
};
