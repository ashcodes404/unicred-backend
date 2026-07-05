const facultyService = require(
  "./faculty.service"
);

const {
  success,
  error,
} = require("../../utils/apiResponse");

/**
 * FACULTY CONTROLLER
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
 */

/**
 * GET /faculty
 *
 * Returns all faculty in the authenticated user's
 * school. Optional ?departmentId= query param narrows
 * the list to one department.
 *
 * Open to every role (enforced in routes).
 */
async function getAllFaculty(req, res) {
  try {
    const departmentId = req.query.departmentId
      ? Number(req.query.departmentId)
      : undefined;

    const faculty =
      await facultyService.getAllFaculty(
        req.schoolId,
        departmentId,
        req.query
      );

    return success(
      res,
      200,
      "Faculty fetched successfully",
      faculty
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
 * GET /faculty/:id
 *
 * Returns a single faculty member.
 *
 * Open to every role (enforced in routes).
 */
async function getFacultyById(req, res) {
  try {
    const facultyId = Number(req.params.id);

    const faculty =
      await facultyService.getFacultyById(
        facultyId,
        req.schoolId
      );

    return success(
      res,
      200,
      "Faculty fetched successfully",
      faculty
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
 * POST /faculty
 *
 * Admin directly creates a faculty record for an
 * existing user (bulk onboarding, etc).
 *
 * schoolId is NOT accepted from frontend.
 * schoolId comes from JWT.
 */
async function createFaculty(req, res) {
  try {
    const faculty =
      await facultyService.createFaculty(
        req.body,
        req.schoolId
      );

    return success(
      res,
      201,
      "Faculty created successfully",
      faculty
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
 * PUT /faculty/:id
 *
 * Admin only. Updates departmentId and/or designation.
 */
async function updateFaculty(req, res) {
  try {
    const facultyId = Number(req.params.id);

    const updatedFaculty =
      await facultyService.updateFaculty(
        facultyId,
        req.schoolId,
        req.body
      );

    return success(
      res,
      200,
      "Faculty updated successfully",
      updatedFaculty
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
 * DELETE /faculty/:id
 *
 * Admin only. Soft deletes faculty.
 */
async function deleteFaculty(req, res) {
  try {
    const facultyId = Number(req.params.id);

    const result =
      await facultyService.deleteFaculty(
        facultyId,
        req.schoolId
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
 * COMPLETE FACULTY PROFILE
 * =====================================================
 *
 * POST /faculty/profile
 *
 * Called by both "faculty" and "hod" roles to create
 * their own Faculty record after registration.
 */
async function completeFacultyProfile(
  req,
  res
) {
  try {
    const faculty =
      await facultyService.completeFacultyProfile(
        req.user,
        req.body
      );

    return success(
      res,
      201,
      "Faculty profile created successfully",
      faculty
    );
  } catch (err) {
    return error(
      res,
      400,
      err.message
    );
  }
}

module.exports = {
  getAllFaculty,
  getFacultyById,
  createFaculty,
  updateFaculty,
  deleteFaculty,
  completeFacultyProfile,
};
