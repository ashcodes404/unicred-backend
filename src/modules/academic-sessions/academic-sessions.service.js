// =============================================================================
// ACADEMIC SESSIONS SERVICE
// =============================================================================
//
// What does the Service layer do?
// --------------------------------
// The service layer is where ALL business logic lives.
//
// It sits between the Controller (HTTP layer) and the Repository (DB layer).
//
// Controller says: "HOD wants to create a session"
// Service answers: "Is this allowed? Are the inputs valid? Do the rules pass?"
// Repository says: "Okay, running the query"
//
// Rules enforced in this file:
//   - Only one ACTIVE session per department at a time
//   - Status transitions are one-way (upcoming→active→completed→archived)
//   - Archived sessions reject ALL write operations
//   - endDate must be after startDate
//   - HOD can only manage their own department's sessions
//
// =============================================================================

const repo = require("./academic-sessions.repository");
const AppError = require("../../utils/AppError");
const { notifyMany , notify } = require("../../utils/notify");
const prisma = require("../../config/db")


// =============================================================================
// ALLOWED STATUS TRANSITIONS
// =============================================================================
//
// This map defines which status transitions are legal.
//
// Key   = current status
// Value = array of statuses the session CAN move to
//
// Examples:
//   "upcoming"  can move to → "active"     ✅
//   "upcoming"  can move to → "archived"   ❌ (not in the list)
//   "archived"  can move to → anything     ❌ (empty array — terminal state)
//
const ALLOWED_TRANSITIONS = {
  upcoming:  ["active"],
  active:    ["completed"],
  completed: ["archived"],
  archived:  [],           // Terminal state — no transitions allowed
};

// =============================================================================
// CREATE
// =============================================================================

/**
 * Create a new academic session.
 *
 * Validations:
 *   1. Required fields present
 *   2. endDate is after startDate
 *   3. semesterType is valid enum value
 *   4. No other ACTIVE session exists for this department (one at a time rule)
 *      Note: We allow multiple "upcoming" sessions — HOD might plan ahead.
 *      But only one can be "active" (running) at a time.
 *
 * @param {number} schoolId         - From JWT
 * @param {number} departmentId     - HOD's department (from their Faculty record)
 * @param {number} createdByUserId  - From JWT (req.user.userId)
 * @param {Object} body             - Request body
 * @returns {Promise<Object>}       - Created session
 */
async function createSession(schoolId, departmentId, createdByUserId, body) {
  const { name, academicYear, semesterType, startDate, endDate } = body;

  // ── Validate required fields ──────────────────────────────────────────────
  if (!name || !academicYear || !semesterType || !startDate || !endDate) {
    throw new AppError(
      400,
      "name, academicYear, semesterType, startDate, and endDate are required."
    );
  }

  // ── Validate semesterType enum ────────────────────────────────────────────
  if (!["odd", "even"].includes(semesterType)) {
    throw new AppError(400, "semesterType must be 'odd' or 'even'.");
  }

  // ── Validate date range ───────────────────────────────────────────────────
  const start = new Date(startDate);
  const end   = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new AppError(400, "startDate and endDate must be valid dates.");
  }

  if (end <= start) {
    throw new AppError(400, "endDate must be after startDate.");
  }

  // ── Enforce: only one active session per department at a time ─────────────
  // We check for active sessions before creation.
  // (New sessions are always created as "upcoming", but this is a safety check.)
  const existingActive = await repo.findActiveSession(schoolId, departmentId);

  if (existingActive) {
    throw new AppError(
      409,
      `An active session "${existingActive.name}" already exists for this department. ` +
      `Complete it before creating a new active session.`
    );
  }

  // ── Check for duplicate session (same dept + academicYear + semesterType) ────
const duplicate = await repo.findDuplicateSession(
  schoolId,
  departmentId,
  academicYear.trim(),
  semesterType
);

if (duplicate) {
  throw new AppError(
    409,
    `A session for "${academicYear} ${semesterType} semester" already exists in this department.`
  );
}

  // ── Create the session ────────────────────────────────────────────────────
const session = await repo.createSession({
  schoolId,
  departmentId,
  createdByUserId,
  name: name.trim(),
  academicYear: academicYear.trim(),
  semesterType,
  startDate: start,
  endDate: end,
  status: "upcoming",
});

const [faculties] = await Promise.all([
  prisma.faculty.findMany({
    where: {
      schoolId,
      departmentId,
      deletedAt: null,
    },
    select: {
      userId: true,
    },
  }),
]);

const userIds = [
  ...faculties.map((f) => f.userId)
];

try {
if (userIds.length > 0) {
  await notifyMany(
    userIds,
    "SESSION_CREATED",
    `New academic session "${session.name}" has been created.`,
    "/dashboard/sessions"
  );
}
} catch (err) {
  console.error("Session notification failed:", err);
}

return session
}

// =============================================================================
// READ
// =============================================================================

/**
 * Get all sessions for a department.
 *
 * Optional query param: ?status=active
 * HOD uses this to filter sessions by lifecycle stage.
 *
 * @param {number} schoolId      - From JWT
 * @param {number} departmentId  - HOD's department
 * @param {string} [status]      - Optional status filter from query string
 * @returns {Promise<Array>}
 */
async function getAllSessions(schoolId, departmentId, status = null) {
  // Validate status if provided
  const validStatuses = ["upcoming", "active", "completed", "archived"];

  if (status && !validStatuses.includes(status)) {
    throw new AppError(
      400,
      `Invalid status. Must be one of: ${validStatuses.join(", ")}.`
    );
  }

  return repo.findAllByDepartment(schoolId, departmentId, status);
}

/**
 * Get a single session by ID.
 *
 * HOD fetches their own department's session.
 * School + department isolation enforced.
 *
 * @param {number} sessionId     - From URL params
 * @param {number} schoolId      - From JWT
 * @param {number} departmentId  - HOD's department
 * @returns {Promise<Object>}
 */
async function getSessionById(sessionId, schoolId, departmentId) {
  const session = await repo.findById(
    parseInt(sessionId),
    schoolId,
    departmentId
  );

  if (!session) {
    throw new AppError(404, "Academic session not found.");
  }

  return session;
}

/**
 * Get session by ID for any authenticated role.
 *
 * Used by faculty and students who need session details
 * but don't own a department.
 * Only school isolation is applied here.
 *
 * @param {number} sessionId - From URL params
 * @param {number} schoolId  - From JWT
 * @returns {Promise<Object>}
 */
async function getSessionByIdForAnyRole(sessionId, schoolId) {
  const session = await repo.findByIdForAnyRole(
    parseInt(sessionId),
    schoolId
  );

  if (!session) {
    throw new AppError(404, "Academic session not found.");
  }

  return session;
}

// =============================================================================
// UPDATE
// =============================================================================

/**
 * Update session metadata (name, dates).
 *
 * Rules:
 *   1. Session must exist and belong to this HOD's department
 *   2. Cannot update an archived session (read-only)
 *   3. endDate must still be after startDate after update
 *   4. Status cannot be changed here — use updateSessionStatus instead
 *
 * @param {number} sessionId     - From URL params
 * @param {number} schoolId      - From JWT
 * @param {number} departmentId  - HOD's department
 * @param {Object} body          - Fields to update
 * @returns {Promise<Object>}    - Updated session
 */
async function updateSession(sessionId, schoolId, departmentId, body) {
  const id = parseInt(sessionId);

  // ── Verify session exists and get current state ───────────────────────────
  const existing = await repo.findById(id, schoolId, departmentId);

  if (!existing) {
    throw new AppError(404, "Academic session not found.");
  }

  // ── Archived sessions are fully read-only ─────────────────────────────────
  if (existing.status === "archived") {
    throw new AppError(
      403,
      "Archived sessions cannot be modified. All records are read-only."
    );
  }

  // ── Build the update payload ──────────────────────────────────────────────
  // Only include fields that were actually sent in the request body.
  // This prevents accidentally nulling out fields not included in the request.
  const allowedFields = ["name", "academicYear", "startDate", "endDate"];
  const data = {};

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      data[field] = body[field];
    }
  }

  // Reject attempts to change status via this endpoint
  if (body.status) {
    throw new AppError(
      400,
      "Cannot change status here. Use PATCH /academic-sessions/:id/status instead."
    );
  }

  if (Object.keys(data).length === 0) {
    throw new AppError(400, "No valid fields provided for update.");
  }

  // ── Validate dates if either was updated ──────────────────────────────────
  const finalStart = data.startDate
    ? new Date(data.startDate)
    : existing.startDate;

  const finalEnd = data.endDate
    ? new Date(data.endDate)
    : existing.endDate;

  if (finalEnd <= finalStart) {
    throw new AppError(400, "endDate must be after startDate.");
  }

  if (data.startDate) data.startDate = new Date(data.startDate);
  if (data.endDate)   data.endDate   = new Date(data.endDate);
  if (data.name)      data.name      = data.name.trim();

  // ── Run update ────────────────────────────────────────────────────────────
  const result = await repo.updateSession(id, schoolId, departmentId, data);

  if (result.count === 0) {
    throw new AppError(404, "Academic session not found.");
  }

  // Return updated record
  return repo.findById(id, schoolId, departmentId);
}

// =============================================================================
// STUDENT PROMOTION HELPER
// =============================================================================

/**
 * promoteStudentsOnCompletion
 *
 * Called automatically when a session is marked "completed".
 * Runs everything inside a single database transaction so either
 * ALL steps succeed or NONE of them are applied — no half-complete state.
 *
 * What it does, step by step:
 *   1. Marks the academic session as "completed"
 *   2. Finds all StudentSessionRegistration rows in this session
 *      that are still "active"
 *      (detained students have status "detained" so they are automatically
 *       skipped — their semester does NOT increment)
 *   3. Increments currentSemester by 1 for each promoted student,
 *      capped at 8 (a student already at semester 8 stays at 8)
 *   4. Flips those registration records from "active" → "completed"
 *
 * Safe to re-run: if all registrations are already "completed" the
 * student/registration updates match zero rows and nothing breaks.
 * Also, ALLOWED_TRANSITIONS blocks "completed" → "completed" outright,
 * so this function can't be triggered twice for the same session anyway.
 *
 * @param {number} sessionId    - The session being completed
 * @param {number} schoolId     - School isolation
 * @param {number} departmentId - Department isolation
 */
async function promoteStudentsOnCompletion(sessionId, schoolId, departmentId) {
  await prisma.$transaction(async (tx) => {
    // Step 1 — Mark the session itself as "completed"
    await tx.academicSession.updateMany({
      where: { id: sessionId, schoolId, departmentId },
      data: { status: "completed" },
    });

    // Step 2 — Find all ACTIVE registrations in this session.
    //           Detained registrations have status "detained" so they are
    //           naturally excluded from this query.
    const activeRegistrations = await tx.studentSessionRegistration.findMany({
      where: { sessionId, schoolId, status: "active" },
      select: { id: true, studentId: true },
    });

    // Nothing to promote — safe early exit (idempotent on re-run)
    if (activeRegistrations.length === 0) return;

    const studentIds      = activeRegistrations.map((r) => r.studentId);
    const registrationIds = activeRegistrations.map((r) => r.id);

    // Step 3 — Increment currentSemester for every promoted student, capped at 8.
    // updateMany's `increment` can't cap per-row, so we fetch each student's
    // current value, compute Math.min(current + 1, 8) in JS, and update
    // each student individually (still inside this same transaction).
    const students = await tx.student.findMany({
      where: { id: { in: studentIds }, schoolId },
      select: { id: true, currentSemester: true },
    });

    await Promise.all(
      students.map((s) =>
        tx.student.update({
          where: { id: s.id },
          data: { currentSemester: Math.min(s.currentSemester + 1, 8) },
        })
      )
    );

    // Step 4 — Flip those registrations from "active" → "completed"
    await tx.studentSessionRegistration.updateMany({
      where: { id: { in: registrationIds } },
      data: { status: "completed" },
    });
  });
}

/**
 * Transition a session's status.
 *
 * This is separate from updateSession because:
 *   - Status transitions have strict lifecycle rules
 *   - They may trigger side effects (e.g. archiving = make all records read-only)
 *   - Keeping it separate makes those rules obvious and explicit
 *
 * Allowed transitions (from ALLOWED_TRANSITIONS map above):
 *   upcoming  → active
 *   active    → completed  (also triggers student promotion via helper above)
 *   completed → archived
 *   archived  → (nothing — terminal state)
 *
 * Additional rule for upcoming → active:
 *   Ensure no other session in the same dept is already active.
 *
 * @param {number} sessionId     - From URL params
 * @param {number} schoolId      - From JWT
 * @param {number} departmentId  - HOD's department
 * @param {string} newStatus     - Desired new status
 * @returns {Promise<Object>}    - Updated session
 */
async function updateSessionStatus(sessionId, schoolId, departmentId, newStatus) {
  const id = parseInt(sessionId);

  // ── Validate new status is a real value ───────────────────────────────────
  const validStatuses = Object.keys(ALLOWED_TRANSITIONS);

  if (!validStatuses.includes(newStatus)) {
    throw new AppError(
      400,
      `Invalid status. Must be one of: ${validStatuses.join(", ")}.`
    );
  }

  // ── Get current status ────────────────────────────────────────────────────
  const current = await repo.findStatusById(id, schoolId, departmentId);

  if (!current) {
    throw new AppError(404, "Academic session not found.");
  }

  // ── Check transition is allowed ───────────────────────────────────────────
  const allowedNext = ALLOWED_TRANSITIONS[current.status];

  if (!allowedNext.includes(newStatus)) {
    // Give a clear, helpful error message
    const canMoveTo = allowedNext.length > 0
      ? allowedNext.join(", ")
      : "nothing (this is a terminal state)";

    throw new AppError(
      400,
      `Cannot transition from "${current.status}" to "${newStatus}". ` +
      `From "${current.status}", you can only move to: ${canMoveTo}.`
    );
  }

  // ── Extra rule: activating a session requires no other active session ─────
  if (newStatus === "active") {
    const existingActive = await repo.findActiveSession(schoolId, departmentId);

    if (existingActive && existingActive.id !== id) {
      throw new AppError(
        409,
        `Session "${existingActive.name}" is already active. ` +
        `Complete or archive it before activating another session.`
      );
    }
  }

  // ── Run the transition ────────────────────────────────────────────────────
  // Completing a session also promotes eligible students — use the special
  // transaction helper. All other transitions are plain status updates.
  if (newStatus === "completed") {
    await promoteStudentsOnCompletion(id, schoolId, departmentId);
  } else {
    await repo.updateSessionStatus(id, schoolId, departmentId, newStatus);
  }

  return repo.findById(id, schoolId, departmentId);
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  createSession,
  getAllSessions,
  getSessionById,
  getSessionByIdForAnyRole,
  updateSession,
  updateSessionStatus,
};