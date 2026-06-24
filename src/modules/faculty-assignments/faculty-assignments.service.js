// =============================================================================
// FACULTY ASSIGNMENTS SERVICE
// =============================================================================

const repo = require("./faculty-assignments.repository");
const sessionRepo = require("../academic-sessions/academic-sessions.repository");
const AppError = require("../../utils/AppError");
const { notify, notifyMany } = require("../../utils/notify");

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
  const duplicate = await repo.findDuplicate(sid, fid, subId, batch);

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

  return repo.findAllBySession(
    schoolId,
    parseInt(query.sessionId),
    departmentId,
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

  return repo.findByFaculty(faculty.id, schoolId, sessionId);
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

  // If changing faculty, validate new faculty exists
  if (data.facultyId) {
    const newFaculty = await getFacultyById(data.facultyId, schoolId);

    if (!newFaculty) {
      throw new AppError(404, "New faculty member not found in this school.");
    }

    // Notify newly assigned faculty
    await notify(
      faculty.user.id,
      "SUBJECT_ASSIGNED",
      `You have been assigned to teach ${assignment.subject.name} ` +
        `(${assignment.subject.courseCode}) for ${assignment.session.name}.`,
      "/faculty/assignments",
    );
  }

  const result = await repo.updateAssignment(id, schoolId, data);

  if (result.count === 0) {
    throw new AppError(404, "Assignment not found.");
  }

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

  return { message: "Assignment removed." };
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
};
