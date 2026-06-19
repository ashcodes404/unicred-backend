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
  return studentRepository.findAllBySchool(schoolId);
}

/**
 * Get a specific student.
 *
 * Repository already enforces school isolation.
 */
async function getStudentById(studentId, schoolId , currentUser) {
  const student = await studentRepository.findById(
    studentId,
    schoolId, 
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
  return studentRepository.createStudent({
    ...studentData,
    schoolId,
  });
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
  return studentRepository.createStudent({
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
}


module.exports = {
  getAllStudents,
  getStudentById,
  createStudent,
  updateStudent,
  deleteStudent,
  completeStudentProfile
};
