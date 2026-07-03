// =============================================================================
// FACULTY ASSIGNMENTS SERVICE
// =============================================================================

const repo = require("./faculty-assignments.repository");
const sessionRepo = require("../academic-sessions/academic-sessions.repository");
const AppError = require("../../utils/AppError");
const { notify, notifyMany } = require("../../utils/notify");
const { cached, invalidate } = require("../../utils/cache");

// Helper: fetch faculty record from DB
// We need this to get the facultyId from a userId,
// and to verify the faculty belongs to this school.
const prisma = require("../../config/db");

async function getFacultyByUserId(userId, schoolId) {
  return prisma.faculty.findFirst({
    where: { userId, schoolId, deletedAt: null },
    select: { id: true, departmentId: true, userId: true },
  });
}

async function getFacultyById(facultyId, schoolId) {
  return prisma.faculty.findFirst({
    where: { id: facultyId, schoolId, deletedAt: null },
    select: {
      id: true,
      departmentId: true,
      user: { select: { id: true, name: true } },
    },
  });
}

// =============================================================================
// CREATE
// =============================================================================

/**
 * Assign a faculty member to a subject for a session.
 *
 * Rules:
 *   1. Session must exist and not be archived
 *   2. Faculty must exist in this school
 *   3. Subject must be offered in this session for this batch (CourseOffering)
 *   4. No duplicate assignment (same faculty+subject+session+batch)
 *   5. HOD can assign themselves
 *
 * Side effect:
 *   Notifies the assigned faculty member: SUBJECT_ASSIGNED
 *
 * @param {number} schoolId          - From JWT
 * @param {number} hodDepartmentId   - HOD's department
 * @param {number} assignedByHodId   - HOD's User ID (req.user.userId)
 * @param {Object} body              - { sessionId, facultyId, subjectId,
 *                                       semesterNumber, batchYear }
 */
async function createAssignment(
  schoolId,
  hodDepartmentId,
  assignedByHodId,
  body,
) {
  const { sessionId, facultyId, subjectId, semesterNumber, batchYear } = body;

  // ── Required fields ───────────────────────────────────────────────────────
  if (!sessionId || !facultyId || !subjectId || !semesterNumber || !batchYear) {
    throw new AppError(
      400,
      "sessionId, facultyId, subjectId, semesterNumber, and batchYear are required.",
    );
  }

  const sid = parseInt(sessionId);
  const fid = parseInt(facultyId);
  const subId = parseInt(subjectId);
  const sem = parseInt(semesterNumber);
  const batch = parseInt(batchYear);

  // ── Validate session ──────────────────────────────────────────────────────
  const session = await sessionRepo.findByIdForAnyRole(sid, schoolId);

  if (!session) {
    throw new AppError(404, "Academic session not found.");
  }

  if (session.status === "archived") {
    throw new AppError(
      403,
      "Cannot create assignments in an archived session.",
    );
  }

  // ── Validate faculty exists in this school ────────────────────────────────
  const faculty = await getFacultyById(fid, schoolId);

  if (!faculty) {
    throw new AppError(404, "Faculty member not found in this school.");
  }

  // ── Validate faculty belongs to the HOD's own department ───────────────────
  // An HOD must only be able to assign faculty from their own department.
  // Without this check, an HOD could assign a faculty member from another
  // department, creating a FacultyAssignment (and later a
  // FacultyResultSubmission) that leaks across department boundaries.
  if (faculty.departmentId !== hodDepartmentId) {
    throw new AppError(400, "Faculty does not belong to this department.");
  }

  // ── Validate subject is offered in this session for this batch ────────────
  // Faculty can only be assigned to offered subjects —
  // not any subject in the department.
  const offering = await prisma.courseOffering.findFirst({
    where: {
      schoolId,
      sessionId: sid,
      subjectId: subId,
      batchYear: batch,
      semesterNumber: sem,
      isActive: true,
    },
    select: { id: true },
  });

  if (!offering) {
    throw new AppError(
      400,
      "This subject is not offered in this session for the specified batch and semester. " +
        "Add a CourseOffering first.",
    );
  }

  // ── Check for duplicate assignment ────────────────────────────────────────
  const duplicate = await repo.findDuplicate(schoolId, sid, fid, subId, batch);

  if (duplicate) {
    throw new AppError(
      409,
      "This faculty member is already assigned to this subject for this session and batch.",
    );
  }

  // ── Create assignment ─────────────────────────────────────────────────────
  const assignment = await repo.createAssignment({
    schoolId,
    sessionId: sid,
    facultyId: fid,
    subjectId: subId,
    departmentId: hodDepartmentId,
    semesterNumber: sem,
    batchYear: batch,
    assignedByHodId,
  });

  await invalidate(`fas:${schoolId}`);

  // ── Notify faculty: SUBJECT_ASSIGNED ─────────────────────────────────────
  // Fire-and-forget — don't let a notification failure block the response
  try {
    await notify(
      faculty.user.id,
      "SUBJECT_ASSIGNED",
      `You have been assigned to teach ${assignment.subject.name} ` +
        `(${assignment.subject.courseCode}) for ${assignment.session.name}.`,
      "/faculty/assignments",
    );
  } catch (error) {
    console.error("Failed to create faculty assignment notification:", error);
  }

  return assignment;
}

// =============================================================================
// READ
// =============================================================================

/**
 * Get all assignments for a session (HOD view).
 *
 * HOD sees all faculty assignments across all subjects for their department.
 * Requires sessionId as query param: ?sessionId=5
 */
async function getAllAssignments(schoolId, departmentId, query) {
  if (!query.sessionId) {
    throw new AppError(400, "sessionId query parameter is required.");
  }

  const sessionId = parseInt(query.sessionId);
  return cached(
    `fas:${schoolId}:all:${departmentId}:${sessionId}`,
    null,
    () => repo.findAllBySession(schoolId, sessionId, departmentId),
    `fas:${schoolId}`
  );
}

/**
 * Get assignments for the logged-in faculty member.
 *
 * Faculty sees only their own assignments.
 * Optional filter: ?sessionId=5
 */
async function getMyAssignments(userId, schoolId, query) {
  // Resolve userId → facultyId
  const faculty = await getFacultyByUserId(userId, schoolId);

  if (!faculty) {
    throw new AppError(404, "Faculty profile not found.");
  }

  const sessionId = query.sessionId ? parseInt(query.sessionId) : null;

  return cached(
    `fas:${schoolId}:mine:${faculty.id}:${sessionId ?? ""}`,
    null,
    () => repo.findByFaculty(faculty.id, schoolId, sessionId),
    `fas:${schoolId}`
  );
}

// =============================================================================
// UPDATE
// =============================================================================

/**
 * Modify an assignment (e.g. change facultyId for a subject mid-session).
 *
 * Allowed changes: facultyId, semesterNumber, batchYear
 * Cannot change: sessionId, subjectId (would be a delete + recreate)
 *
 * Side effect:
 *   Notifies newly assigned faculty if facultyId changed.
 */
async function updateAssignment(assignmentId, schoolId, body) {
  const id = parseInt(assignmentId);

  // Fetch the existing assignment (must include subject + session for the notify message below)
  const existing = await repo.findById(id, schoolId);

  if (!existing) {
    throw new AppError(404, "Assignment not found.");
  }

  if (existing.session.status === "archived") {
    throw new AppError(
      403,
      "Cannot modify assignments in an archived session.",
    );
  }

  const allowed = ["facultyId", "semesterNumber", "batchYear"];
  const data = {};

  for (const field of allowed) {
    if (body[field] !== undefined) {
      data[field] = parseInt(body[field]);
    }
  }

  if (Object.keys(data).length === 0) {
    throw new AppError(400, "No valid fields provided for update.");
  }

  // If changing faculty, validate the new faculty exists in this school
  if (data.facultyId) {
    const newFaculty = await getFacultyById(data.facultyId, schoolId);

    if (!newFaculty) {
      throw new AppError(404, "New faculty member not found in this school.");
    }

    // Notify the newly assigned faculty.
    // Use "newFaculty" (not "faculty") and "existing" (not "assignment") —
    // those were the undefined variables causing the 500 crash.
    // Wrapped in try/catch so a notification failure never blocks the update.
    try {
      await notify(
        newFaculty.user.id,
        "SUBJECT_ASSIGNED",
        `You have been assigned to teach ${existing.subject.name} ` +
          `(${existing.subject.courseCode}) for ${existing.session.name}.`,
        "/faculty/assignments",
      );
    } catch (error) {
      console.error("Failed to notify reassigned faculty:", error);
    }
  }

  const result = await repo.updateAssignment(id, schoolId, data);

  if (result.count === 0) {
    throw new AppError(404, "Assignment not found.");
  }

  await invalidate(`fas:${schoolId}`);

  return repo.findById(id, schoolId);
}

// =============================================================================
// DELETE
// =============================================================================

/**
 * Remove a faculty assignment.
 *
 * Cannot remove from an archived session.
 * Cannot remove if faculty has already submitted marks for this subject
 * (that would orphan result submissions — checked here).
 */
async function deleteAssignment(assignmentId, schoolId) {
  const id = parseInt(assignmentId);

  const existing = await repo.findById(id, schoolId);

  if (!existing) {
    throw new AppError(404, "Assignment not found.");
  }

  if (existing.session.status === "archived") {
    throw new AppError(
      403,
      "Cannot remove assignments from an archived session.",
    );
  }

  // Check if faculty has already submitted marks — if so, block deletion
  const submission = await prisma.facultyResultSubmission.findFirst({
    where: {
      facultyId: existing.facultyId,
      subjectId: existing.subjectId,
      isSubmitted: true,
    },
    select: { id: true },
  });

  if (submission) {
    throw new AppError(
      400,
      "Cannot remove this assignment — the faculty has already submitted marks for this subject.",
    );
  }

  await repo.deleteAssignment(id, schoolId);

  await invalidate(`fas:${schoolId}`);

  return { message: "Assignment removed." };
}

// =============================================================================
// STUDENT-FACING: WHO TEACHES MY SUBJECT?
// =============================================================================

/**
 * getFacultyForStudentSubject
 *
 * Answers the question: "Which faculty member teaches subject X in MY session?"
 *
 * Why is this scoped to the student's OWN active registration?
 *   A student must never be able to query faculty assignments for a different
 *   batch year, semester, or session — that would expose other cohorts' data.
 *
 *   Instead of accepting sessionId/batchYear/semesterNumber as params (which
 *   a malicious user could tamper with), we derive those values from the
 *   student's own active registration in the database.
 *   This makes the scope entirely server-enforced, not client-supplied.
 *
 * Flow:
 *   userId (JWT) → Student record → active Registration
 *     → { sessionId, batchYear, semesterNumber }
 *       → FacultyAssignment for this exact context
 *
 * @param {number} userId    - From JWT (req.user.userId)
 * @param {number} schoolId  - From JWT (req.user.schoolId)
 * @param {number|string} subjectId - From URL params
 * @returns {Promise<Object>} - The faculty assignment with full faculty profile
 */
async function getFacultyForStudentSubject(userId, schoolId, subjectId) {
  // Step 1: Resolve userId → Student record.
  // The JWT carries userId (User table PK), not the Student table PK.
  const student = await prisma.student.findFirst({
    where: { userId, schoolId, deletedAt: null },
    select: { id: true },
  });

  if (!student) {
    throw new AppError(404, "Student profile not found.");
  }

  // Step 2: Find this student's active session registration.
  // This gives us the three values that fully identify the student's cohort:
  //   sessionId      — which academic session they are in
  //   batchYear      — which batch they belong to
  //   semesterNumber — which semester they are currently studying
  // All three are required to find the RIGHT faculty assignment.
  const registration = await prisma.studentSessionRegistration.findFirst({
    where: { studentId: student.id, schoolId, status: "active" },
    select: { sessionId: true, batchYear: true, semesterNumber: true },
  });

  if (!registration) {
    throw new AppError(404, "You are not registered in any active session.");
  }

  // Step 3: Look up the faculty assignment for exactly this student's context.
  // Using all five dimensions ensures we match the correct assignment and
  // never leak data from another batch or session.
  const assignment = await repo.findForStudentSubject(
    schoolId,
    registration.sessionId,
    parseInt(subjectId),
    registration.batchYear,
    registration.semesterNumber,
  );

  if (!assignment) {
    throw new AppError(404, "No faculty assigned to this subject yet.");
  }

  return assignment;
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  createAssignment,
  getAllAssignments,
  getMyAssignments,
  updateAssignment,
  deleteAssignment,
  getFacultyForStudentSubject,
};
