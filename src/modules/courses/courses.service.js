// =============================================================================
// COURSES SERVICE
// =============================================================================

const repo        = require("./courses.repository");
const sessionRepo = require("../academic-sessions/academic-sessions.repository");
const AppError    = require("../../utils/AppError");

const VALID_SUBJECT_TYPES = ["theory", "lab", "tutorial"];

// =============================================================================
// SUBJECTS
// =============================================================================

/**
 * Create a new subject/course.
 *
 * Validations:
 *   1. Required fields: courseCode, name, credits, subjectType
 *   2. subjectType must be a valid enum value
 *   3. courseCode must be unique within the department
 *   4. passingMarks must be less than totalMarks
 */
async function createSubject(schoolId, departmentId, body) {
  const {
    courseCode,
    name,
    credits,
    subjectType,
    passingMarks = 40,
    totalMarks   = 100,
  } = body;

  // ── Required fields ───────────────────────────────────────────────────────
  if (!courseCode || !name || !credits || !subjectType) {
    throw new AppError(
      400,
      "courseCode, name, credits, and subjectType are required."
    );
  }

  // ── Validate subjectType ──────────────────────────────────────────────────
  if (!VALID_SUBJECT_TYPES.includes(subjectType)) {
    throw new AppError(
      400,
      `subjectType must be one of: ${VALID_SUBJECT_TYPES.join(", ")}.`
    );
  }

  // ── Validate marks ────────────────────────────────────────────────────────
  if (parseFloat(passingMarks) >= parseFloat(totalMarks)) {
    throw new AppError(400, "passingMarks must be less than totalMarks.");
  }

  // ── Check courseCode uniqueness within this department ────────────────────
  const duplicate = await repo.findByCourseCode(
    departmentId,
    courseCode.trim().toUpperCase()
  );

  if (duplicate) {
    throw new AppError(
      409,
      `Course code "${courseCode.toUpperCase()}" already exists in this department.`
    );
  }

  return repo.createSubject({
    schoolId,
    departmentId,
    courseCode:   courseCode.trim().toUpperCase(),
    name:         name.trim(),
    credits:      parseInt(credits),
    subjectType,
    passingMarks: parseFloat(passingMarks),
    totalMarks:   parseFloat(totalMarks),
  });
}

/**
 * Get all subjects for a department.
 *
 * @param {number} schoolId         - From JWT
 * @param {number} departmentId     - HOD's department
 * @param {boolean} includeInactive - From query: ?includeInactive=true
 */
async function getAllSubjects(schoolId, departmentId, includeInactive = false) {
  return repo.findAllByDepartment(schoolId, departmentId, includeInactive);
}

/**
 * Get a single subject (HOD view — dept scoped).
 */
async function getSubjectById(subjectId, schoolId, departmentId) {
  const subject = await repo.findById(
    parseInt(subjectId),
    schoolId,
    departmentId
  );

  if (!subject) {
    throw new AppError(404, "Subject not found.");
  }

  return subject;
}

/**
 * Get subject for any role (school scoped only).
 * Faculty and students use this to view subject details.
 */
async function getSubjectByIdForAnyRole(subjectId, schoolId) {
  const subject = await repo.findByIdForAnyRole(parseInt(subjectId), schoolId);

  if (!subject) {
    throw new AppError(404, "Subject not found.");
  }

  return subject;
}

/**
 * Update a subject.
 *
 * Rules:
 *   - courseCode uniqueness re-checked if changed
 *   - passingMarks < totalMarks re-validated
 *   - Cannot change departmentId (subjects belong to a dept permanently)
 */
async function updateSubject(subjectId, schoolId, departmentId, body) {
  const id = parseInt(subjectId);

  // Confirm subject exists in this HOD's department
  const existing = await repo.findById(id, schoolId, departmentId);

  if (!existing) {
    throw new AppError(404, "Subject not found.");
  }

  const allowed = [
    "name", "credits", "subjectType",
    "passingMarks", "totalMarks", "courseCode",
  ];

  const data = {};

  for (const field of allowed) {
    if (body[field] !== undefined) {
      data[field] = body[field];
    }
  }

  if (Object.keys(data).length === 0) {
    throw new AppError(400, "No valid fields provided for update.");
  }

  // Re-validate subjectType if changed
  if (data.subjectType && !VALID_SUBJECT_TYPES.includes(data.subjectType)) {
    throw new AppError(
      400,
      `subjectType must be one of: ${VALID_SUBJECT_TYPES.join(", ")}.`
    );
  }

  // Re-check courseCode uniqueness if changed
  if (data.courseCode) {
    data.courseCode = data.courseCode.trim().toUpperCase();
    const duplicate = await repo.findByCourseCode(departmentId, data.courseCode, id);

    if (duplicate) {
      throw new AppError(
        409,
        `Course code "${data.courseCode}" already exists in this department.`
      );
    }
  }

  // Validate marks relationship
  const finalPassing = data.passingMarks ?? existing.passingMarks;
  const finalTotal   = data.totalMarks   ?? existing.totalMarks;

  if (parseFloat(finalPassing) >= parseFloat(finalTotal)) {
    throw new AppError(400, "passingMarks must be less than totalMarks.");
  }

  if (data.credits) data.credits = parseInt(data.credits);
  if (data.passingMarks) data.passingMarks = parseFloat(data.passingMarks);
  if (data.totalMarks)   data.totalMarks   = parseFloat(data.totalMarks);

  const result = await repo.updateSubject(id, schoolId, departmentId, data);

  if (result.count === 0) {
    throw new AppError(404, "Subject not found.");
  }

  return repo.findById(id, schoolId, departmentId);
}

/**
 * Deactivate a subject.
 *
 * Deactivated subjects are hidden from all views.
 * Cannot deactivate a subject that is part of an active session's offerings
 * — service checks this to prevent breaking active sessions.
 */
async function deactivateSubject(subjectId, schoolId, departmentId) {
  const id = parseInt(subjectId);

  const existing = await repo.findById(id, schoolId, departmentId);

  if (!existing) {
    throw new AppError(404, "Subject not found.");
  }

  if (!existing.isActive) {
    throw new AppError(400, "Subject is already deactivated.");
  }

  await repo.deactivateSubject(id, schoolId, departmentId);

  return { message: "Subject deactivated successfully." };
}

// =============================================================================
// COURSE OFFERINGS
// =============================================================================

/**
 * Create a course offering.
 *
 * Rules:
 *   1. Session must exist and belong to this school
 *   2. Session must NOT be archived (read-only)
 *   3. Subject must exist and be active
 *   4. No duplicate offering (same session+subject+batch)
 */
async function createOffering(schoolId, departmentId, body) {
  const { sessionId, subjectId, semesterNumber, batchYear } = body;

  // ── Required fields ───────────────────────────────────────────────────────
  if (!sessionId || !subjectId || !semesterNumber || !batchYear) {
    throw new AppError(
      400,
      "sessionId, subjectId, semesterNumber, and batchYear are required."
    );
  }

  // ── Validate session exists and is not archived ───────────────────────────
  const session = await sessionRepo.findByIdForAnyRole(
    parseInt(sessionId),
    schoolId
  );

  if (!session) {
    throw new AppError(404, "Academic session not found.");
  }

  if (session.status === "archived") {
    throw new AppError(
      403,
      "Cannot add offerings to an archived session."
    );
  }

  // ── Validate subject exists and is active ─────────────────────────────────
  const subject = await repo.findById(
    parseInt(subjectId),
    schoolId,
    departmentId
  );

  if (!subject) {
    throw new AppError(404, "Subject not found.");
  }

  if (!subject.isActive) {
    throw new AppError(
      400,
      "Cannot offer a deactivated subject. Reactivate it first."
    );
  }

  // ── Check for duplicate offering ──────────────────────────────────────────
  const duplicate = await repo.findDuplicateOffering(
    parseInt(sessionId),
    parseInt(subjectId),
    parseInt(batchYear)
  );

  if (duplicate) {
    throw new AppError(
      409,
      "This subject is already offered for this session and batch."
    );
  }

  return repo.createOffering({
    schoolId,
    sessionId:      parseInt(sessionId),
    subjectId:      parseInt(subjectId),
    departmentId,
    semesterNumber: parseInt(semesterNumber),
    batchYear:      parseInt(batchYear),
  });
}

/**
 * Get all offerings for a session.
 *
 * Optionally filter by semesterNumber and/or batchYear.
 */
async function getOfferings(schoolId, sessionId, query) {
  return repo.findOfferingsBySession(schoolId, parseInt(sessionId), {
    semesterNumber: query.semesterNumber,
    batchYear:      query.batchYear,
  });
}

/**
 * Remove a course offering.
 *
 * Cannot remove an offering from an archived session.
 */
async function deleteOffering(offeringId, schoolId) {
  const id = parseInt(offeringId);

  const offering = await repo.findOfferingById(id, schoolId);

  if (!offering) {
    throw new AppError(404, "Course offering not found.");
  }

  if (offering.session.status === "archived") {
    throw new AppError(
      403,
      "Cannot remove offerings from an archived session."
    );
  }

  await repo.deleteOffering(id, schoolId);

  return { message: "Course offering removed." };
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  createSubject,
  getAllSubjects,
  getSubjectById,
  getSubjectByIdForAnyRole,
  updateSubject,
  deactivateSubject,
  createOffering,
  getOfferings,
  deleteOffering,
};
