// =============================================================================
// FACULTY CONTEXT MIDDLEWARE
// =============================================================================
//
// What does this middleware do?
// ------------------------------
// The JWT payload contains: { id (userId), schoolId, role }
//
// It does NOT contain departmentId.
//
// But HOD routes need to know: "Which department does this HOD manage?"
//
// This middleware:
//   1. Takes req.user.UserId (userId from JWT)
//   2. Looks up the Faculty record for this user
//   3. Attaches req.faculty = { id (facultyId), departmentId }
//
// Every HOD route uses req.faculty.departmentId to scope their queries.
//
// Why not put this in auth middleware?
// -------------------------------------
// Not every route needs faculty context — students and admins don't have
// a Faculty record. Loading it on every request would be wasteful.
// Instead, we load it only on routes that need it (HOD routes).
//
// How to use in routes:
// ----------------------
//   router.post(
//     "/",
//     requireRole("hod"),
//     facultyContext,       ← add this after requireRole
//     controller.create
//   );
//
// =============================================================================

const prisma   = require("../config/db");
const AppError = require("../utils/AppError");

/**
 * Fetches the Faculty record for the logged-in user and attaches it to req.
 *
 * Attaches: req.faculty = { id: number, departmentId: number }
 *
 * Throws 404 if no Faculty record found.
 * This should only be applied to routes where the user is faculty or HOD.
 */
async function facultyContext(req, res, next) {
  try {
    const faculty = await prisma.faculty.findFirst({
      where: {
        userId:    req.user.userId,
        schoolId:  req.user.schoolId,
        deletedAt: null,
      },

      select: {
        id:           true,
        departmentId: true,
      },
    });


    if (!faculty) {
      return next(
        new AppError(
          404,
          "Faculty profile not found. Please contact your administrator."
        )
      );
    }

    // Attach to request — available as req.faculty in controllers and services
    req.faculty = faculty;

    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { facultyContext };
