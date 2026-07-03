// =============================================================================
// STUDENT SESSION REGISTRATION SERVICE
// =============================================================================

const repo = require("./student-registration.repository");
const sessionRepo = require("../academic-sessions/academic-sessions.repository");
const AppError = require("../../utils/AppError");
const prisma = require("../../config/db");
const { notifyMany, notify } = require("../../utils/notify");
const { cached, invalidate } = require("../../utils/cache");

// =============================================================================
// REGISTER A STUDENT
// =============================================================================

/**
 * Register a student into an academic session.
 *
 * Rules:
 *   1. Session must exist and not be archived
 *   2. Student must exist in this school
 *   3. Student cannot already be registered in this session
 *   4. Student cannot have two active registrations simultaneously
 *
 * After registration, the student's dashboard will automatically show
 * the subjects offered in this session for their dept+batch+semester
 * (via CourseOffering — no extra step needed).
 *
 * @param {number} schoolId    - From JWT
 * @param {Object} body        - { studentId, sessionId, semesterNumber, batchYear }
 */
async function registerStudent(schoolId, body) {
  const { studentId, sessionId, semesterNumber, batchYear } = body;

  if (!studentId || !sessionId || !semesterNumber || !batchYear) {
    throw new AppError(
      400,
      "studentId, sessionId, semesterNumber, and batchYear are required.",
    );
  }

  const sid = parseInt(studentId);
  const sesId = parseInt(sessionId);
  const sem = parseInt(semesterNumber);
  const batch = parseInt(batchYear);

  // ── Validate session ──────────────────────────────────────────────────────
  const session = await sessionRepo.findByIdForAnyRole(sesId, schoolId);

  if (!session) {
    throw new AppError(404, "Academic session not found.");
  }

  if (session.status === "archived") {
    throw new AppError(403, "Cannot register students in an archived session.");
  }

  // ── Validate student exists in this school ────────────────────────────────
  const student = await prisma.student.findFirst({
    where: { id: sid, schoolId, deletedAt: null },
    select: { id: true, userId: true, batchYear: true, currentSemester: true },
  });

  if (!student) {
    throw new AppError(404, "Student not found in this school.");
  }

  // ── Check not already registered in this session ──────────────────────────
  const existingReg = await repo.findByStudentAndSession(sid, sesId);

  if (existingReg) {
    throw new AppError(409, "Student is already registered for this session.");
  }

  // ── Check student doesn't already have an active registration ─────────────
  const activeReg = await repo.findActiveRegistration(sid, schoolId);

  if (activeReg) {
    throw new AppError(
      409,
      `Student is already enrolled in an active session: "${activeReg.session.name}". ` +
        `Complete that session before registering for a new one.`,
    );
  }

  const registration = await repo.createRegistration({
    schoolId,
    studentId: sid,
    sessionId: sesId,
    semesterNumber: sem,
    batchYear: batch,
    status: "active",
  });

  // ── Notify Student ────────────────────────────────────────────
  try {
    await notify(
      student.userId,
      "SESSION_REGISTERED",
      `You have been successfully registered for ${session.name}.`,
      "/student/session",
    );
  } catch (error) {
    console.error("Failed to create student registration notification:", error);
  }

  await invalidate(`sreg:${schoolId}`);

  return registration;
}

/**
 * Bulk register multiple students into a session.
 *
 * HOD typically registers all students of a batch at once.
 * Processes each student individually and collects results.
 *
 * Returns:
 *   { registered: [...], skipped: [...] }
 *   "skipped" = already registered or validation failed (non-fatal errors)
 *
 * @param {number} schoolId - From JWT
 * @param {Object} body     - { sessionId, semesterNumber, batchYear, studentIds: [1,2,3] }
 */
async function bulkRegisterStudents(schoolId, body) {
  const { sessionId, semesterNumber, batchYear, studentIds } = body;

  // ─────────────────────────────────────────────────────────────
  // Validation
  // ─────────────────────────────────────────────────────────────

  if (
    !sessionId ||
    !semesterNumber ||
    !batchYear ||
    !Array.isArray(studentIds)
  ) {
    throw new AppError(
      400,
      "sessionId, semesterNumber, batchYear, and studentIds (array) are required.",
    );
  }

  if (studentIds.length === 0) {
    throw new AppError(400, "studentIds array cannot be empty.");
  }

  if (studentIds.length > 200) {
    throw new AppError(400, "Cannot register more than 200 students at once.");
  }

  const sesId = parseInt(sessionId);
  const sem = parseInt(semesterNumber);
  const batch = parseInt(batchYear);

  // ─────────────────────────────────────────────────────────────
  // Validate Session
  // ─────────────────────────────────────────────────────────────

  const session = await sessionRepo.findByIdForAnyRole(sesId, schoolId);

  if (!session) {
    throw new AppError(404, "Academic session not found.");
  }

  if (session.status === "archived") {
    throw new AppError(403, "Cannot register students in an archived session.");
  }

  // ─────────────────────────────────────────────────────────────
  // Prepare Student IDs
  // ─────────────────────────────────────────────────────────────

  const studentIdNumbers = studentIds.map(Number);

  // ─────────────────────────────────────────────────────────────
  // Fetch All Students Once
  // ─────────────────────────────────────────────────────────────

  const students = await prisma.student.findMany({
    where: {
      id: {
        in: studentIdNumbers,
      },
      schoolId,
      deletedAt: null,
    },
    select: {
      id: true,
      userId: true,
    },
  });

  const studentMap = new Map(students.map((student) => [student.id, student]));

  // ─────────────────────────────────────────────────────────────
  // Existing Registrations In This Session
  // ─────────────────────────────────────────────────────────────

  const existingRegistrations =
    await prisma.studentSessionRegistration.findMany({
      where: {
        sessionId: sesId,
        studentId: {
          in: studentIdNumbers,
        },
      },
      select: {
        studentId: true,
      },
    });

  const existingSet = new Set(existingRegistrations.map((r) => r.studentId));

  // ─────────────────────────────────────────────────────────────
  // Active Registrations
  // ─────────────────────────────────────────────────────────────

  const activeRegistrations = await prisma.studentSessionRegistration.findMany({
    where: {
      schoolId,
      status: "active",
      studentId: {
        in: studentIdNumbers,
      },
    },
    select: {
      studentId: true,
      session: {
        select: {
          name: true,
        },
      },
    },
  });

  const activeMap = new Map(
    activeRegistrations.map((reg) => [reg.studentId, reg.session.name]),
  );

  // ─────────────────────────────────────────────────────────────
  // Registration Processing
  // ─────────────────────────────────────────────────────────────

  const registered = [];
  const skipped = [];
  const notificationUserIds = [];

  for (const sid of studentIdNumbers) {
    try {
      const student = studentMap.get(sid);

      // Student not found
      if (!student) {
        skipped.push({
          studentId: sid,
          reason: "Student not found.",
        });
        continue;
      }

      // Already registered in this session
      if (existingSet.has(sid)) {
        skipped.push({
          studentId: sid,
          reason: "Already registered in this session.",
        });
        continue;
      }

      // Already enrolled elsewhere
      if (activeMap.has(sid)) {
        skipped.push({
          studentId: sid,
          reason: `Already enrolled in active session "${activeMap.get(sid)}".`,
        });
        continue;
      }

      // Create registration
      const registration = await repo.createRegistration({
        schoolId,
        studentId: sid,
        sessionId: sesId,
        semesterNumber: sem,
        batchYear: batch,
        status: "active",
      });

      registered.push(registration);

      // Queue notification
      if (student.userId) {
        notificationUserIds.push(student.userId);
      }
    } catch (error) {
      console.error(`Registration failed for student ${sid}:`, error);

      skipped.push({
        studentId: sid,
        reason: "Registration failed.",
      });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Bulk Notifications
  // ─────────────────────────────────────────────────────────────

  if (notificationUserIds.length > 0) {
    try {
      await notifyMany(
        notificationUserIds,
        "SESSION_REGISTERED",
        `You have been successfully registered for ${session.name}.`,
        "/student/session",
      );
    } catch (error) {
      console.error("Failed to create bulk registration notifications:", error);
    }
  }

  await invalidate(`sreg:${schoolId}`);

  // ─────────────────────────────────────────────────────────────
  // Response
  // ─────────────────────────────────────────────────────────────

  return {
    registered,
    skipped,
    summary: {
      total: studentIdNumbers.length,
      registered: registered.length,
      skipped: skipped.length,
    },
  };
}

// =============================================================================
// READ
// =============================================================================

/**
 * Get the logged-in student's current session info.
 */
async function getMySession(userId, schoolId) {
  // Resolve userId → studentId
  const student = await prisma.student.findFirst({
    where: { userId, schoolId, deletedAt: null },
    select: { id: true },
  });

  if (!student) {
    throw new AppError(
      404,
      "Student profile not found. Please complete your profile setup first.",
    );
  }

  const registration = await cached(
    `sreg:${schoolId}:mine:${student.id}`,
    null,
    () => repo.findActiveRegistration(student.id, schoolId),
    `sreg:${schoolId}`
  );

  if (!registration) {
    throw new AppError(
      404,
      "You are not registered in any active session. Please contact your HOD.",
    );
  }

  return registration;
}

/**
 * Get all students registered in a session (HOD view).
 *
 * Optional filters: ?semesterNumber=3&batchYear=2022
 */
async function getStudentsInSession(schoolId, sessionId, query) {
  if (!sessionId) {
    throw new AppError(400, "sessionId is required.");
  }

  return cached(
    `sreg:${schoolId}:session:${sessionId}:${query.semesterNumber ?? ""}:${query.batchYear ?? ""}`,
    null,
    () => repo.findAllBySession(schoolId, parseInt(sessionId), {
      semesterNumber: query.semesterNumber,
      batchYear: query.batchYear,
    }),
    `sreg:${schoolId}`
  );
}

// =============================================================================
// DETAIN / UNDETAIN A STUDENT
// =============================================================================

/**
 * detainStudent
 *
 * Mark a student's session registration as "detained".
 *
 * What "detained" means:
 *   The student has not met the requirements to advance to the next semester.
 *   When the session is later completed, the automatic promotion logic only
 *   promotes "active" registrations — "detained" students are skipped, so
 *   their currentSemester stays exactly the same.
 *
 * Rules enforced here:
 *   1. Registration must exist and belong to this school     → 404 otherwise
 *   2. Session must still be open (not completed/archived)   → 403 otherwise
 *   3. Already detained                                      → 409 conflict
 *   4. Registration must be "active" to detain               → 400 otherwise
 *
 * @param {number} schoolId        - From JWT (school isolation)
 * @param {number} registrationId  - The StudentSessionRegistration id (URL :id)
 * @returns {{ message: string }}
 */
async function detainStudent(schoolId, registrationId) {
  const regId = parseInt(registrationId);

  // Load the registration together with its session status and student's userId
  // so we can enforce rules and send a notification — all in one query.
  const registration = await prisma.studentSessionRegistration.findFirst({
    where: { id: regId, schoolId },
    include: {
      session: { select: { status: true, name: true } },
      student: { select: { userId: true } },
    },
  });

  // 404 — registration doesn't exist in this school
  if (!registration) {
    throw new AppError(404, "Student registration not found.");
  }

  // 403 — session is already closed; no modifications allowed
  if (["completed", "archived"].includes(registration.session.status)) {
    throw new AppError(
      403,
      `Cannot detain a student in a "${registration.session.status}" session.`
    );
  }

  // 409 — already detained, nothing to do
  if (registration.status === "detained") {
    throw new AppError(409, "Student is already detained in this session.");
  }

  // 400 — registration is in some other unexpected state (e.g. "completed")
  if (registration.status !== "active") {
    throw new AppError(
      400,
      `Cannot detain a student whose registration status is "${registration.status}".`
    );
  }

  // All checks passed — flip status to "detained"
  await prisma.studentSessionRegistration.update({
    where: { id: regId },
    data: { status: "detained" },
  });

  // Notify the student so they know to contact their HOD
  try {
    await notify(
      registration.student.userId,
      "DETAINED",
      `You have been detained in session "${registration.session.name}". Please contact your HOD for details.`,
      "/student/session"
    );
  } catch (err) {
    console.error("Failed to send detention notification:", err);
  }

  await invalidate(`sreg:${schoolId}`);

  return { message: "Student has been detained successfully." };
}

/**
 * undetainStudent
 *
 * Remove a student's detention — flip their registration back to "active".
 *
 * Once undetained, the student will again be included in the automatic
 * semester promotion when the session is completed.
 *
 * Rules enforced here:
 *   1. Registration must exist and belong to this school     → 404 otherwise
 *   2. Session must still be open (not completed/archived)   → 403 otherwise
 *   3. Registration must currently be "detained" to undetain → 400 otherwise
 *
 * @param {number} schoolId        - From JWT (school isolation)
 * @param {number} registrationId  - The StudentSessionRegistration id (URL :id)
 * @returns {{ message: string }}
 */
async function undetainStudent(schoolId, registrationId) {
  const regId = parseInt(registrationId);

  // Load the registration together with its session status and student's userId
  const registration = await prisma.studentSessionRegistration.findFirst({
    where: { id: regId, schoolId },
    include: {
      session: { select: { status: true, name: true } },
      student: { select: { userId: true } },
    },
  });

  // 404 — registration doesn't exist in this school
  if (!registration) {
    throw new AppError(404, "Student registration not found.");
  }

  // 403 — session is already closed; no modifications allowed
  if (["completed", "archived"].includes(registration.session.status)) {
    throw new AppError(
      403,
      `Cannot undetain a student in a "${registration.session.status}" session.`
    );
  }

  // 400 — only a "detained" registration can be undetained
  if (registration.status !== "detained") {
    throw new AppError(
      400,
      `Cannot undetain a student whose registration status is "${registration.status}". ` +
      `Only detained students can be undetained.`
    );
  }

  // All checks passed — flip status back to "active"
  await prisma.studentSessionRegistration.update({
    where: { id: regId },
    data: { status: "active" },
  });

  // Notify the student that their detention has been lifted
  try {
    await notify(
      registration.student.userId,
      "UNDETAINED",
      `Your detention in session "${registration.session.name}" has been lifted. You are now active again.`,
      "/student/session"
    );
  } catch (err) {
    console.error("Failed to send undetain notification:", err);
  }

  await invalidate(`sreg:${schoolId}`);

  return { message: "Student has been undetained successfully." };
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  registerStudent,
  bulkRegisterStudents,
  getMySession,
  getStudentsInSession,
  detainStudent,
  undetainStudent,
};
