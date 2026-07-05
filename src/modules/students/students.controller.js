const studentService = require("./students.service");
const {
  success,
  error,
} = require("../../utils/apiResponse");

/**
 * STUDENT CONTROLLER
 *
 * Responsibilities:
 * - Read request data
 * - Call service layer
 * - Send HTTP response
 *
 * Never:
 * - Write Prisma queries
 * - Write authorization logic
 * - Write business logic
 *
 * Those belong elsewhere.
 */

/**
 * GET /students
 *
 * Returns all students belonging
 * to the authenticated user's school.
 */
async function getAllStudents(req, res) {
  try {
    const data =
      await studentService.getAllStudents(
        req.schoolId,
        req.query
      );

    return success(
      res,
      200,
      "Students fetched successfully",
      data
    );
  } catch (err) {
    return error(
      res,
      500,
      err.message
    );
  }
}

/**
 * GET /students/:id
 *
 * Returns a single student.
 */
async function getStudentById(req, res) {
  try {
    const studentId = Number(req.params.id);

    const student =
      await studentService.getStudentById(
        studentId,
        req.schoolId ,
        req.user
      );

    return success(
      res,
      200,
      "Student fetched successfully",
      student
    );
  } catch (err) {
    return error(
      res,
      404,
      err.message
    );
  }
}

/**
 * POST /students
 *
 * Creates a new student.
 *
 * schoolId is NOT accepted from frontend.
 * schoolId comes from JWT.
 */
async function createStudent(req, res) {
  try {
    const student =
      await studentService.createStudent(
        req.body,
        req.schoolId
      );

    return success(
      res,
      201,
      "Student created successfully",
      student
    );
  } catch (err) {
    return error(
      res,
      400,
      err.message
    );
  }
}

/**
 * PUT /students/:id
 *
 * Updates student.
 */
async function updateStudent(req, res) {
  try {
    const studentId = Number(req.params.id);

    const updatedStudent =
      await studentService.updateStudent(
        studentId,
        req.schoolId,
        req.body,
        req.user
      );

    return success(
      res,
      200,
      "Student updated successfully",
      updatedStudent
    );
  } catch (err) {
    return error(
      res,
      400,
      err.message
    );
  }
}

/**
 * DELETE /students/:id
 *
 * Soft deletes student.
 */
async function deleteStudent(req, res) {
  try {
    const studentId = Number(req.params.id);

    const result =
      await studentService.deleteStudent(
        studentId,
        req.schoolId,
        req.user
      );

    return success(
      res,
      200,
      result.message
    );
  } catch (err) {
    return error(
      res,
      400,
      err.message
    );
  }
}

/**
 * =====================================================
 * COMPLETE STUDENT PROFILE
 * =====================================================
 *
 * Route:
 *
 * POST /students/profile
 *
 * Purpose:
 *
 * Registration only creates:
 *
 * User
 *
 * This endpoint creates:
 *
 * Student
 *
 * linked to the logged-in user.
 *
 * Request Body:
 *
 * {
 *   "departmentId": 1,
 *   "rollNo": "2024CSE101",
 *   "branch": "CSE",
 *   "batchYear": 2024,
 *   "graduationYear": 2028,
 *   "currentSemester": 3
 * }
 *
 * userId and schoolId are NOT
 * accepted from frontend.
 *
 * They come from JWT.
 */
async function completeStudentProfile(
  req,
  res
) {
  try {

    
    const student =
      await studentService.completeStudentProfile(
        req.user,
        req.body
      );

    return success(
      res,
      201,
      "Student profile created successfully",
      student
    );
  } catch (err) {
    return error(
      res,
      400,
      err.message
    );
  }
}

/**
 * =====================================================
 * GET MY STUDENT PROFILE
 * =====================================================
 *
 * Route:
 *
 * GET /students/profile/me
 *
 * Purpose:
 *
 * After login, frontend needs to know:
 * "Has this student already filled their profile?"
 *
 * If YES -> show read-only profile view
 * If NO  -> show the profile creation form
 *
 * userId comes from JWT (req.user), never from params.
 */
async function getMyStudentProfile(req, res) {
  try {
    const student =
      await studentService.getMyStudentProfile(
        req.user.userId
      );

    // No error if not found — frontend uses "data: null"
    // to decide whether to show the form.
    return success(
      res,
      200,
      student
        ? "Student profile fetched successfully"
        : "Student profile not yet created",
      student
    );
  } catch (err) {
    return error(
      res,
      500,
      err.message
    );
  }
}

/**
 * GET /students/filter
 *
 * Returns students that match the provided query params.
 * All params are optional — the same endpoint covers:
 *
 *   /students/filter                              → all students in school
 *   /students/filter?departmentId=3               → all students in dept 3
 *   /students/filter?departmentId=3&batchYear=2022 → dept 3, batch 2022
 *   /students/filter?departmentId=3&batchYear=2022&semesterNumber=5
 *                                                 → dept 3, batch 2022, sem 5
 *
 * Allowed roles: admin, faculty, hod (enforced in the route layer).
 */
async function getStudentsByFilters(req, res) {
  try {
    const students =
      await studentService.getStudentsByFilters(
        req.schoolId,
        req.query
      );

    return success(
      res,
      200,
      "Students fetched successfully",
      students
    );
  } catch (err) {
    return error(
      res,
      500,
      err.message
    );
  }
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