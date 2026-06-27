// src/middleware/studentContext.middleware.js
// Attaches req.student to the request for student routes.
// Works the same way as your existing facultyContext.middleware.js.
// Add this file alongside your existing middleware.

const prisma = require("../config/db");
const AppError = require("../utils/AppError");

/**
 * Looks up the Student record for the logged-in user and attaches it to req.student.
 * Must run AFTER authenticate middleware (needs req.user.userId).
 *
 * req.student will have: id, departmentId, rollNo, batchYear, currentSemester, etc.
 */
async function studentContext(req, res, next) {
  try {
    const student = await prisma.student.findFirst({
      where: { userId: req.user.userId, schoolId: req.user.schoolId },
    });

    if (!student) {
      return next(new AppError(404, "Student profile not found for this user"));
    }

    req.student = student;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = studentContext;
