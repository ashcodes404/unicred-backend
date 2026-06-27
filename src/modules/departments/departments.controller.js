const departmentService = require(
  "./departments.service"
);

const {
  success,
  error,
} = require("../../utils/apiResponse");

/**
 * =====================================================
 * DEPARTMENT CONTROLLER
 * =====================================================
 *
 * Controller Responsibilities:
 *
 * ✅ Read req.body
 * ✅ Read req.params
 * ✅ Read req.user
 * ✅ Call service layer
 * ✅ Return HTTP responses
 *
 * Controller MUST NOT:
 *
 * ❌ Talk to Prisma
 * ❌ Contain business logic
 * ❌ Contain authorization logic
 *
 * Think of controller as:
 *
 * Request Translator
 *
 * It converts:
 *
 * HTTP Request
 *
 * into
 *
 * Service Function Calls
 *
 * BUGFIX: every function below now consistently reads
 * req.schoolId (set by tenantMiddleware) instead of
 * mixing it with req.user.schoolId. Both previously
 * pointed at the same value when tenantMiddleware ran,
 * but two of these functions used req.schoolId while
 * tenantMiddleware was never wired into the routes —
 * see departments.routes.js for the actual fix.
 */

/**
 * =====================================================
 * GET ALL DEPARTMENTS
 * =====================================================
 *
 * Route:
 *
 * GET /departments
 *
 * Returns all departments
 * belonging to current school.
 */
async function getAllDepartments(
  req,
  res
) {
  try {
    const departments =
      await departmentService.getAllDepartments(
        req.schoolId
      );

    return success(
      res,
      200,
      "Departments fetched successfully",
      departments
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
 * =====================================================
 * GET DEPARTMENT BY ID
 * =====================================================
 *
 * Route:
 *
 * GET /departments/:id
 *
 * Example:
 *
 * GET /departments/3
 *
 * req.params.id = 3
 */
async function getDepartmentById(
  req,
  res
) {
  try {
    const departmentId =
      Number(req.params.id);

    const department =
      await departmentService.getDepartmentById(
        departmentId,
        req.schoolId
      );

    return success(
      res,
      200,
      "Department fetched successfully",
      department
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
 * =====================================================
 * CREATE DEPARTMENT
 * =====================================================
 *
 * Route:
 *
 * POST /departments
 *
 * Body:
 *
 * {
 *   "name": "CSE"
 * }
 *
 * schoolId does NOT come
 * from frontend.
 *
 * schoolId comes from JWT
 * via tenantMiddleware (req.schoolId).
 */
async function createDepartment(
  req,
  res
) {
  try {
    const { name } = req.body;

    const department =
      await departmentService.createDepartment(
        name,
        req.schoolId
      );

    return success(
      res,
      201,
      "Department created successfully",
      department
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
 * UPDATE DEPARTMENT
 * =====================================================
 *
 * Route:
 *
 * PUT /departments/:id
 *
 * Example:
 *
 * PUT /departments/2
 */
async function updateDepartment(
  req,
  res
) {
  try {
    const departmentId =
      Number(req.params.id);

    const updatedDepartment =
      await departmentService.updateDepartment(
        departmentId,
        req.schoolId,
        req.body
      );

    return success(
      res,
      200,
      "Department updated successfully",
      updatedDepartment
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
 * DELETE DEPARTMENT
 * =====================================================
 *
 * Route:
 *
 * DELETE /departments/:id
 *
 * Soft delete only.
 */
async function deleteDepartment(
  req,
  res
) {
  try {
    const departmentId =
      Number(req.params.id);

    const result =
      await departmentService.deleteDepartment(
        departmentId,
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
 * RECONCILE HOD ROLES (self-heal)
 * =====================================================
 *
 * Route:
 *
 * POST /api/departments/reconcile-hods
 *
 * Access:
 *
 * ADMIN only
 *
 * Demotes any user who is still role="hod" but heads no
 * department back to "faculty". Cleans up old bad data.
 */
async function reconcileHods(
  req,
  res
) {
  try {
    const result =
      await departmentService.reconcileAllHodRoles(
        req.schoolId
      );

    return success(
      res,
      200,
      "HOD roles reconciled successfully",
      result
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
 * EXPORTS
 * =====================================================
 */
module.exports = {
  getAllDepartments,
  getDepartmentById,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  reconcileHods,
};