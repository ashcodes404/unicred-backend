const studentRepository = require("./students.repository");

const facultyRepository =
  require("../faculty/faculty.repository");

const {
  canAccessStudent,
  isFaculty,
  isHod,
} = require("../../utils/authorization");

const departmentRepository = require(
  "../departments/departments.repository"
);

const { cached, invalidate } = require("../../utils/cache");

/**
 * STUDENT SERVICE
 *
 * Responsibilities:
 * - Business logic
 * - Authorization checks
 * - Validation
 * - Orchestration
 *
 * Never:
 * - Read req.body
 * - Read req.params
 * - Send HTTP responses
 *
 * Those belong to controller.
 */

/**
 * Get all students belonging to the user's school.
 *
 * Because repository filters by schoolId,
 * users can never see students from another school.
 */
async function getAllStudents(schoolId) {
  return cached(
    `stu:${schoolId}:all`,
    null,
    () => studentRepository.findAllBySchool(schoolId),
    `stu:${schoolId}`
  );
}

/**
 * Get a specific student.
 *
 * Repository already enforces school isolation.
 */
async function getStudentById(studentId, schoolId , currentUser) {
  const student = await cached(
    `stu:${schoolId}:one:${studentId}`,
    null,
    () => studentRepository.findById(studentId, schoolId),
    `stu:${schoolId}`
  );

  if (!student) {
    throw new Error("Student not found");
  }

  await authorizeStudentAccess(
  currentUser,
  student,
  schoolId
  );

  return student;
}



/**
 * Create student.
 *
 * IMPORTANT:
 * schoolId comes from JWT.
 * Never trust frontend schoolId.
 */
async function createStudent(studentData, schoolId) {
  const student = await studentRepository.createStudent({
    ...studentData,
    schoolId,
  });
  await invalidate(`stu:${schoolId}`);
  return student;
}

/**
 * Update student.
 *
 * Future authorization rules:
 *
 * Admin:
 *   Can update any student in school.
 *
 * HOD:
 *   Can update only students in own department.
 *
 * Student:
 *   Can update only own profile.
 *
 * For now we implement school-level isolation only.
 */
async function updateStudent(
  studentId,
  schoolId,
  updateData,
  currentUser
) {
  const existingStudent =
    await studentRepository.findById(
      studentId,
      schoolId
    );

  if (!existingStudent) {
    throw new Error("Student not found");
  }

  await authorizeStudentAccess(
  currentUser,
  existingStudent,
  schoolId
  );

  await studentRepository.updateStudent(
    studentId,
    schoolId,
    updateData
  );

  await invalidate(`stu:${schoolId}`);
  if (existingStudent.userId) {
    await invalidate(`stu:profile:${existingStudent.userId}`);
  }

  return studentRepository.findById(
    studentId,
    schoolId
  );
}

/**
 * Soft delete student.
 */
async function deleteStudent(
  studentId,
  schoolId,
  currentUser
) {
  const existingStudent =
    await studentRepository.findById(
      studentId,
      schoolId
    );

  if (!existingStudent) {
    throw new Error("Student not found");
  }

  await authorizeStudentAccess(
  currentUser,
  existingStudent,
  schoolId
  );

  await studentRepository.deleteStudent(
    studentId,
    schoolId
  );

  await invalidate(`stu:${schoolId}`);
  if (existingStudent.userId) {
    await invalidate(`stu:profile:${existingStudent.userId}`);
  }

  return {
    success: true,
    message: "Student deleted successfully",
  };
}

/**
 * =====================================================
 * STUDENT AUTHORIZATION ORCHESTRATOR
 * =====================================================
 *
 * Purpose:
 *
 * authorization.js contains only rules.
 *
 * This helper gathers all data required
 * by those rules.
 *
 * Example:
 *
 * Faculty access check needs:
 *
 * faculty.departmentId
 *
 * HOD access check needs:
 *
 * hodDepartment.id
 *
 * This helper loads that information
 * and then delegates the decision
 * to canAccessStudent().
 */

async function authorizeStudentAccess(
  currentUser,
  student,
  schoolId
) {
  let facultyInfo = null;
  let hodDepartment = null;

  /**
   * Faculty Authorization Context
   *
   * NOTE: JWT payload only has `userId`, not `id`.
   * Using currentUser.id here was a bug — it's always
   * undefined, so this lookup silently failed for
   * every faculty user.
   */
  if (isFaculty(currentUser.role)) {
    facultyInfo =
      await facultyRepository.findByUserId(
        currentUser.userId
      );
  }

  /**
   * HOD Authorization Context
   *
   * Same fix: currentUser.id -> currentUser.userId.
   */
  if (isHod(currentUser.role)) {
    hodDepartment =
      await facultyRepository.findDepartmentByHodUserId(
        currentUser.userId,
        schoolId
      );
  }

  /**
   * Run Authorization Rules
   */
  const allowed = canAccessStudent(
    currentUser,
    student,
    facultyInfo,
    hodDepartment
  );

  if (!allowed) {
    const error = new Error(
      "Access denied"
    );

    error.statusCode = 403;

    throw error;
  }
}

/**
 * =====================================================
 * COMPLETE STUDENT PROFILE
 * =====================================================
 *
 * Purpose:
 *
 * Registration only creates:
 *
 * User
 *
 * Example:
 *
 * {
 *   email,
 *   password,
 *   role,
 *   schoolId
 * }
 *
 * It does NOT create:
 *
 * Student
 *
 * This function creates the
 * Student record after registration.
 *
 * Request Flow:
 *
 * Student Login
 *      ↓
 * JWT
 *      ↓
 * req.user
 *      ↓
 * Controller
 *      ↓
 * Service
 *      ↓
 * Repository
 *      ↓
 * Prisma
 *      ↓
 * MySQL
 *
 * Parameters:
 *
 * currentUser
 *     Comes from JWT
 *
 * profileData
 *     Comes from req.body
 */
async function completeStudentProfile(
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
   * one Student profile.
   */
  const existingStudent =
    await studentRepository.findByUserId(
      currentUser.userId
    );

  if (existingStudent) {
    throw new Error(
      "Student profile already exists"
    );
  }

  /**
   * ---------------------------------------------------
   * STEP 2
   * Verify roll number uniqueness
   * ---------------------------------------------------
   *
   * Roll numbers must be unique.
   */
 const existingRollNo =
  await studentRepository.findBySchoolAndRollNo(
    currentUser.schoolId,
    profileData.rollNo
  );

  if (existingRollNo) {
    throw new Error(
      "Roll number already exists"
    );
  }

  /**
   * ---------------------------------------------------
   * STEP 3
   * Verify department exists
   * ---------------------------------------------------
   *
   * Student cannot join
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
   * STEP 4
   * Create Student Record
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
  const student = await studentRepository.createStudent({
    userId: currentUser.userId,

    schoolId: currentUser.schoolId,

    departmentId:
      profileData.departmentId,

    rollNo: profileData.rollNo,

    branch: profileData.branch,

    batchYear:
      profileData.batchYear,

    graduationYear:
      profileData.graduationYear,

    currentSemester:
      profileData.currentSemester,
  });

  await invalidate(`stu:${currentUser.schoolId}`);
  await invalidate(`stu:profile:${currentUser.userId}`);

  return student;
}

/**
 * =====================================================
 * GET MY STUDENT PROFILE
 * =====================================================
 *
 * Looks up the Student record linked to the
 * currently logged-in user's userId.
 *
 * Returns null (not an error) if the student
 * hasn't completed their profile yet —
 * this is a normal, expected state right after
 * registration, not a failure.
 */
async function getMyStudentProfile(userId) {
  return cached(
    `stu:profile:${userId}`,
    null,
    () => studentRepository.findByUserId(userId),
    `stu:profile:${userId}`
  );
}


/**
 * getStudentsByFilters
 *
 * Fetches students belonging to the caller's school,
 * narrowed down by whichever query params the caller provides.
 *
 * All three filters are optional — pass none and you get every
 * student in the school; pass all three and you get a very
 * specific slice (e.g. "CSE batch 2022 currently in sem 5").
 *
 * Why parse here instead of in the controller?
 *   Query params arrive as STRINGS (e.g. "3", "2022").
 *   The repository expects NUMBERS so Prisma can build a
 *   correct WHERE clause. Service is the right place to
 *   convert types and ignore empty/missing values.
 *
 * @param {number} schoolId - always comes from JWT (never trust frontend)
 * @param {Object} query    - raw req.query object from Express
 */
async function getStudentsByFilters(schoolId, query) {
  // Helper: parse a query param to int only if it's a non-empty string.
  // Returns undefined (not NaN) when the param is absent or blank,
  // so the repository knows to skip that filter entirely.
  const parseIfPresent = (val) =>
    val !== undefined && val !== "" ? parseInt(val, 10) : undefined;

  const filters = {
    departmentId:  parseIfPresent(query.departmentId),
    batchYear:     parseIfPresent(query.batchYear),
    semesterNumber: parseIfPresent(query.semesterNumber),
  };

  return cached(
    `stu:${schoolId}:filter:${filters.departmentId ?? ""}:${filters.batchYear ?? ""}:${filters.semesterNumber ?? ""}`,
    null,
    () => studentRepository.findByFilters(schoolId, filters),
    `stu:${schoolId}`
  );
}

module.exports = {
  getAllStudents,
  getStudentById,
  createStudent,
  updateStudent,
  deleteStudent,
  completeStudentProfile,
  getMyStudentProfile,
  getStudentsByFilters,
};
