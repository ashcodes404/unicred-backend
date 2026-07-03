const departmentRepository = require(
  "./departments.repository"
);

const userRepository = require(
  "../users/users.repository"
);

const { cached, invalidate } = require("../../utils/cache");

/**
 * =====================================================
 * HELPER: reconcileHodRole  (written by us)
 * =====================================================
 *
 * Makes ONE user's `role` agree with reality:
 *
 *   heads >= 1 department  → role must be "hod"
 *   heads 0 departments    → role must be "faculty"
 *
 * The department table (its hodUserId column) is the
 * single source of truth for "who is an HOD". This helper
 * just DERIVES the role from it — which means one function
 * covers every case you asked for:
 *
 *   - admin assigns a faculty as HOD      → promotes
 *   - admin moves headship to someone new → demotes the old
 *   - admin unassigns the HOD             → demotes
 *   - leftover hod heading nothing        → demotes (self-heal)
 *
 * Students and admins are never touched — only the two
 * roles that take part in headship (faculty <-> hod).
 */
async function reconcileHodRole(userId, schoolId) {
  // No user to reconcile (e.g. there was no previous HOD).
  if (!userId) {
    return;
  }

  const user = await userRepository.findById(
    userId,
    schoolId
  );

  // User may be deactivated or from another school — skip safely.
  if (!user) {
    return;
  }

  // Never auto-flip a student or an admin.
  if (
    user.role !== "faculty" &&
    user.role !== "hod"
  ) {
    return;
  }

  // How many departments does this user currently head?
  const headedDepartments =
    await departmentRepository.findDepartmentsByHod(
      userId,
      schoolId
    );

  const headsAtLeastOne =
    headedDepartments.length > 0;

  if (headsAtLeastOne && user.role !== "hod") {
    // Faculty just became a head → promote to hod.
    await userRepository.updateRole(
      userId,
      schoolId,
      "hod"
    );
  } else if (
    !headsAtLeastOne &&
    user.role === "hod"
  ) {
    // Former head now heads nothing → demote to faculty.
    await userRepository.updateRole(
      userId,
      schoolId,
      "faculty"
    );
  }
}

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
  return cached(
    `dept:${schoolId}:all`,
    null,
    () => departmentRepository.findAllBySchool(schoolId),
    `dept:${schoolId}`
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
  const department = await cached(
    `dept:${schoolId}:${departmentId}`,
    null,
    () => departmentRepository.findById(departmentId, schoolId),
    `dept:${schoolId}`
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
  const department = await departmentRepository.createDepartment({
    schoolId,
    name: normalizedName,
  });

  await invalidate(`dept:${schoolId}`);

  return department;
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

  // Remember who currently heads this department, so we can
  // demote them later if they get replaced or unassigned.
  const previousHodUserId =
    existingDepartment.hodUserId;

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
   *
   * NOTE: we do NOT require the target to already be an
   * "hod". The whole point is that assigning a faculty
   * here PROMOTES them. The actual role change happens
   * after the department write, via reconcileHodRole().
   */
  if (hodUserId !== undefined) {
    if (hodUserId === null) {
      // Explicit unassignment — department will have no HOD.
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

      // A HOD must be a teaching member. Only a faculty
      // (to be promoted) or an existing hod are allowed.
      // Students and admins can never head a department.
      if (
        hodUser.role !== "faculty" &&
        hodUser.role !== "hod"
      ) {
        throw new Error(
          "Only a faculty member can be made HOD"
        );
      }

      // Enforce "one HOD heads one department": reject if
      // this user already heads a DIFFERENT department.
      const alreadyHeads =
        await departmentRepository.findDepartmentsByHod(
          hodUserId,
          schoolId
        );

      const headsAnotherDept = alreadyHeads.some(
        (dept) => dept.id !== departmentId
      );

      if (headsAnotherDept) {
        throw new Error(
          "This user is already HOD of another department"
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

  /**
   * Keep user roles in sync with the new headship.
   *
   * The department write above is the source of truth.
   * We only act if the HOD actually changed.
   *
   * - reconcile the NEW user  → promotes faculty to hod
   * - reconcile the OLD user  → demotes them to faculty
   *                             (since one HOD heads only
   *                             one department, losing it
   *                             means they head nothing)
   *
   * reconcileHodRole ignores null ids and same-as-before
   * cases on its own, so this stays safe for unassignment.
   */
  if (
    hodUserId !== undefined &&
    hodUserId !== previousHodUserId
  ) {
    await reconcileHodRole(hodUserId, schoolId);
    await reconcileHodRole(
      previousHodUserId,
      schoolId
    );
  }

  await invalidate(`dept:${schoolId}`);

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
 * 3. Reconcile the ex-HOD's role — deleting the department removes their
 *    headship, so if they now head nothing they must be demoted to faculty
 *    (otherwise they'd keep the HOD role + interface while leading nothing).
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

  // Remember who headed it, so we can demote them after the delete.
  const previousHodUserId =
    existingDepartment.hodUserId;

  await departmentRepository.deleteDepartment(
    departmentId,
    schoolId
  );

  await invalidate(`dept:${schoolId}`);

  // The headship is gone — demote the old HOD to faculty if they now head
  // no active department. reconcileHodRole no-ops on null / still-heading.
  await reconcileHodRole(
    previousHodUserId,
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
 * RECONCILE ALL HOD ROLES  (self-heal, written by us)
 * =====================================================
 *
 * One-shot cleanup for an ENTIRE school.
 *
 * Finds every user whose role is "hod" but who heads no
 * active department, and demotes them to "faculty".
 *
 * Use this to fix data that went bad BEFORE this logic
 * existed (the original bug), or as a periodic safety net.
 *
 * Returns the list of users that were demoted.
 */
async function reconcileAllHodRoles(schoolId) {
  // findAllBySchool(schoolId, "hod") returns every user in
  // this school whose role is "hod".
  const hodUsers =
    await userRepository.findAllBySchool(
      schoolId,
      "hod"
    );

  const demoted = [];

  for (const user of hodUsers) {
    const headed =
      await departmentRepository.findDepartmentsByHod(
        user.id,
        schoolId
      );

    // role is "hod" but heads nothing → demote.
    if (headed.length === 0) {
      await userRepository.updateRole(
        user.id,
        schoolId,
        "faculty"
      );

      demoted.push({
        userId: user.id,
        name: user.name,
      });
    }
  }

  return {
    success: true,
    demotedCount: demoted.length,
    demoted,
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
  reconcileAllHodRoles,
};