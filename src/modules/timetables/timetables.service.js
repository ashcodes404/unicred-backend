// =============================================================================
// TIMETABLES SERVICE  (src/modules/timetables/timetables.service.js)
// =============================================================================
//
// The "service" holds all the BUSINESS RULES. Controllers just pass data in and
// send the result out; the repository just reads/writes the database. This file
// is where we decide what is allowed and what is rejected.
//
// Rules implemented here:
//   - One timetable per (session + department + batch + semester)
//   - Slots can only change while status is "draft" OR "returned"
//   - No faculty double-booking and no room double-booking
//     (checked session-wide, using real time-overlap, not exact match)
//   - A faculty can only be slotted for a subject they are actually assigned to
//   - Status flow: draft → submitted → approved, plus returned → resubmit
//
// =============================================================================

const repo        = require("./timetables.repository");
const sessionRepo = require("../academic-sessions/academic-sessions.repository");
const prisma      = require("../../config/db"); // used for cross-table lookups
const AppError    = require("../../utils/AppError");
const { notify, notifyMany } = require("../../utils/notify");
const { isValidTime, timesOverlap, isEndAfterStart } = require("../../utils/time");
const { isValidUrl } = require("../../utils/validators");
const NOTIFICATION_TYPES = require("../../constants/notificationTypes");
const { cached, invalidate } = require("../../utils/cache");

// dayOfWeek uses ISO numbering: 1 = Monday ... 7 = Sunday.
const MIN_DAY = 1;
const MAX_DAY = 7;

// A timetable's slots may only be added/edited/removed in these states.
// After submission it is locked until an admin returns it.
const EDITABLE_STATUSES = ["draft", "returned"];

// =============================================================================
// SMALL INTERNAL HELPERS
// =============================================================================

/**
 * getAdminUserIds — every active admin in a school (to notify on submit).
 * A school may have several admins, so we collect all of them.
 *
 * Built-in used:
 *   Array.prototype.map(fn) → turns [{id:1},{id:2}] into [1, 2].
 *
 * @param {number} schoolId
 * @returns {Promise<number[]>}
 */
async function getAdminUserIds(schoolId) {
  const admins = await prisma.user.findMany({
    where: { schoolId, role: "admin", isActive: true, deletedAt: null },
    select: { id: true },
  });
  return admins.map((a) => a.id);
}

/**
 * getHodUserId — the userId of the HOD who runs a department
 * (to notify on approve/return).
 *
 * The `?.` (optional chaining) safely reads a property that might be missing,
 * and `??` (nullish coalescing) supplies a fallback of null.
 *
 * @param {number} departmentId
 * @param {number} schoolId
 * @returns {Promise<number|null>}
 */
async function getHodUserId(departmentId, schoolId) {
  const dept = await prisma.department.findFirst({
    where: { id: departmentId, schoolId },
    select: { hodUserId: true },
  });
  return dept?.hodUserId ?? null;
}

/**
 * getTimetableOr404 — load a timetable or throw a 404.
 * Written once so every method gives the same error and never forgets the
 * school scope.
 *
 * @param {number} id
 * @param {number} schoolId
 * @returns {Promise<Object>}
 */
async function getTimetableOr404(id, schoolId) {
  const timetable = await repo.findById(id, schoolId);
  if (!timetable) {
    throw new AppError(404, "Timetable not found.");
  }
  return timetable;
}

/**
 * assertEditable — throw unless the timetable is in an editable state.
 * Keeps the same message everywhere slots are touched.
 *
 * @param {Object} timetable
 */
function assertEditable(timetable) {
  if (!EDITABLE_STATUSES.includes(timetable.status)) {
    throw new AppError(
      403,
      `Slots can only be changed while the timetable is draft or returned ` +
        `(current: "${timetable.status}").`,
    );
  }
}

// =============================================================================
// TIMETABLE — CREATE
// =============================================================================

/**
 * createTimetable — HOD starts a new (empty) weekly timetable for one
 * batch+semester of a session.
 *
 * Rules: session must exist and not be archived; no duplicate for the same
 * session + department + batch + semester.
 *
 * @param {number} schoolId      from JWT
 * @param {number} departmentId  HOD's department (req.faculty.departmentId)
 * @param {Object} body          { sessionId, batchYear, semesterNumber }
 * @returns {Promise<Object>}
 */
async function createTimetable(schoolId, departmentId, body) {
  const { sessionId, batchYear, semesterNumber } = body;

  if (!sessionId || !batchYear || !semesterNumber) {
    throw new AppError(
      400,
      "sessionId, batchYear, and semesterNumber are required.",
    );
  }

  // parseInt converts a string like "2024" from the request body into a number.
  const sid   = parseInt(sessionId);
  const batch = parseInt(batchYear);
  const sem   = parseInt(semesterNumber);

  const session = await sessionRepo.findByIdForAnyRole(sid, schoolId);
  if (!session) {
    throw new AppError(404, "Academic session not found.");
  }
  if (session.status === "archived") {
    throw new AppError(403, "Cannot create a timetable in an archived session.");
  }

  const duplicate = await repo.findDuplicate(sid, departmentId, batch, sem);
  if (duplicate) {
    throw new AppError(
      409,
      "A timetable already exists for this session, batch, and semester.",
    );
  }

  const timetable = await repo.createTimetable({
    schoolId,
    sessionId: sid,
    departmentId,
    batchYear: batch,
    semesterNumber: sem,
  });

  await invalidate(`tt:${schoolId}`);

  return timetable;
}

// =============================================================================
// TIMETABLE — READ
// =============================================================================

/**
 * getDepartmentTimetables — HOD lists their department's timetables.
 * Optional ?sessionId filter.
 */
async function getDepartmentTimetables(schoolId, departmentId, query) {
  const sessionId = query.sessionId ? parseInt(query.sessionId) : null;
  return cached(
    `tt:${schoolId}:dept:${departmentId}:${sessionId ?? ""}`,
    null,
    () => repo.findAllByDepartment(schoolId, departmentId, sessionId),
    `tt:${schoolId}`
  );
}

/**
 * getTimetableById — read one timetable by id, scoped to the caller's
 * department so a user can never open another department's timetable.
 *   - admin           : any timetable in the school
 *   - hod / faculty    : only their own department's
 *   - student          : only their own department's, and only once approved
 *
 * @param {number|string} id
 * @param {{ userId:number, role:string, schoolId:number }} user
 */
async function getTimetableById(id, user) {
  // Cached separately from getTimetableOr404 (used by write paths), so a
  // stale cache entry can never let a mutation act on an out-of-date status.
  const tid = parseInt(id);
  const timetable = await cached(
    `tt:${user.schoolId}:one:${tid}`,
    null,
    () => repo.findById(tid, user.schoolId),
    `tt:${user.schoolId}`
  );
  if (!timetable) {
    throw new AppError(404, "Timetable not found.");
  }

  // Admins oversee every department in their school.
  if (user.role === "admin") return timetable;

  const departmentId = await resolveUserDepartmentId(user);

  if (!departmentId || departmentId !== timetable.departmentId) {
    throw new AppError(403, "This timetable belongs to another department.");
  }

  // Students and faculty only ever see a published (approved) timetable —
  // drafts and pending-approval versions stay with the HOD and admin.
  if (user.role !== "hod" && timetable.status !== "approved") {
    throw new AppError(403, "This timetable has not been published yet.");
  }

  return timetable;
}

/**
 * resolveUserDepartmentId — find the department a non-admin user belongs to.
 * HOD/faculty come from the Faculty table; students from the Student table.
 * Returns null for admins (they aren't tied to one department) or if missing.
 *
 * @param {{ userId:number, role:string, schoolId:number }} user
 * @returns {Promise<number|null>}
 */
async function resolveUserDepartmentId(user) {
  if (user.role === "hod" || user.role === "faculty") {
    const faculty = await prisma.faculty.findFirst({
      where: { userId: user.userId, schoolId: user.schoolId },
      select: { departmentId: true },
    });
    return faculty?.departmentId ?? null;
  }
  if (user.role === "student") {
    const student = await prisma.student.findFirst({
      where: { userId: user.userId, schoolId: user.schoolId },
      select: { departmentId: true },
    });
    return student?.departmentId ?? null;
  }
  return null;
}

// =============================================================================
// DEPARTMENT TIMETABLE DOCUMENT (uploaded PDF/image)
// =============================================================================

/**
 * setDepartmentTimetableDocument — HOD uploads (or replaces) their department's
 * timetable file. departmentId comes from the HOD's own record, never the body,
 * so a HOD can only ever set their OWN department's timetable.
 *
 * @param {number} schoolId
 * @param {number} departmentId
 * @param {string} fileUrl      Cloudinary URL of the uploaded PDF/image
 * @param {number} uploadedById HOD's user id
 */
async function setDepartmentTimetableDocument(schoolId, departmentId, fileUrl, uploadedById) {
  if (!fileUrl || !isValidUrl(fileUrl)) {
    throw new AppError(400, "A valid uploaded file URL is required.");
  }

  const doc = await repo.upsertDepartmentDocument(schoolId, departmentId, fileUrl, uploadedById);
  await invalidate(`tt:${schoolId}`);

  // Notify everyone in the department that a new timetable is available —
  // all faculty and students of the department, but NOT the HOD who just
  // uploaded it. Faculty and students have different timetable pages, so
  // each group gets a link to its own.
  const [faculty, students] = await Promise.all([
    prisma.faculty.findMany({
      where: { schoolId, departmentId, deletedAt: null, userId: { not: uploadedById } },
      select: { userId: true },
    }),
    prisma.student.findMany({
      where: { schoolId, departmentId, deletedAt: null },
      select: { userId: true },
    }),
  ]);

  const message = "A new timetable has been uploaded for your department.";
  await notifyMany(
    faculty.map((f) => f.userId),
    NOTIFICATION_TYPES.TIMETABLE_UPLOADED,
    message,
    "/faculty/timetable",
  );
  await notifyMany(
    students.map((s) => s.userId),
    NOTIFICATION_TYPES.TIMETABLE_UPLOADED,
    message,
    "/student/timetable",
  );

  return doc;
}

/**
 * getDepartmentTimetableDocument — the timetable file for the CALLER's own
 * department. Works for HOD, faculty, and students; each only ever sees their
 * own department's document. Returns null when nothing has been uploaded.
 *
 * @param {{ userId:number, role:string, schoolId:number }} user
 * @returns {Promise<Object|null>}
 */
async function getDepartmentTimetableDocument(user) {
  const departmentId = await resolveUserDepartmentId(user);
  if (!departmentId) {
    throw new AppError(403, "No department is associated with your account.");
  }
  return cached(
    `tt:${user.schoolId}:doc:${departmentId}`,
    null,
    () => repo.findDepartmentDocument(user.schoolId, departmentId),
    `tt:${user.schoolId}`
  );
}

// =============================================================================
// TIMETABLE — UPDATE (only while draft/returned)
// =============================================================================

/**
 * updateTimetable — HOD fixes a timetable's own fields (batch/semester typos).
 * sessionId is deliberately NOT editable: changing it would move the timetable
 * to a different session and invalidate every slot's conflict scope.
 */
async function updateTimetable(id, schoolId, body) {
  const timetable = await getTimetableOr404(parseInt(id), schoolId);
  assertEditable(timetable);

  const allowed = ["batchYear", "semesterNumber"];
  const data = {};
  for (const field of allowed) {
    if (body[field] !== undefined) data[field] = parseInt(body[field]);
  }

  // Object.keys(data) lists the keys we collected; length 0 means nothing valid.
  if (Object.keys(data).length === 0) {
    throw new AppError(400, "No valid fields provided for update.");
  }

  await repo.updateTimetable(timetable.id, schoolId, data);
  await invalidate(`tt:${schoolId}`);
  return repo.findById(timetable.id, schoolId);
}

// =============================================================================
// SLOTS — validation + conflict engine
// =============================================================================

/**
 * validateSlotShape — cheap, database-free checks on a slot's raw input:
 * required fields, day range, and time format. Used by both add and edit.
 *
 * @param {Object} input   the request body
 * @param {boolean} partial when true (edit) only the provided fields are checked
 */
function validateSlotShape(input, partial = false) {
  // `need(field)` is true if we must validate this field now. On a full add we
  // validate all; on a partial edit we validate only fields that were sent.
  const need = (field) => !partial || input[field] !== undefined;

  if (need("subjectId") && !input.subjectId) {
    throw new AppError(400, "subjectId is required.");
  }
  if (need("facultyId") && !input.facultyId) {
    throw new AppError(400, "facultyId is required.");
  }
  if (need("classroom") && !input.classroom) {
    throw new AppError(400, "classroom is required.");
  }

  if (need("dayOfWeek")) {
    const day = parseInt(input.dayOfWeek);
    // Number.isNaN(x) is true when x is "Not a Number" (e.g. bad input).
    if (Number.isNaN(day) || day < MIN_DAY || day > MAX_DAY) {
      throw new AppError(400, "dayOfWeek must be 1 (Monday) through 7 (Sunday).");
    }
  }

  if (need("startTime") && !isValidTime(input.startTime)) {
    throw new AppError(400, "startTime must be a valid 24-hour time, e.g. 09:00.");
  }
  if (need("endTime") && !isValidTime(input.endTime)) {
    throw new AppError(400, "endTime must be a valid 24-hour time, e.g. 10:00.");
  }
}

/**
 * assertNoConflicts — runs the three slot rules against the database:
 *   1. the faculty is assigned to this subject (FacultyAssignment exists)
 *   2. the faculty has no other class overlapping this day+time (session-wide)
 *   3. the classroom has no other class overlapping this day+time (session-wide)
 *
 * @param {Object} ctx { schoolId, timetable, subjectId, facultyId, dayOfWeek,
 *                       startTime, endTime, classroom, excludeSlotId }
 */
async function assertNoConflicts(ctx) {
  const {
    schoolId, timetable, subjectId, facultyId,
    dayOfWeek, startTime, endTime, classroom, excludeSlotId = null,
  } = ctx;

  // End must come after start.
  if (!isEndAfterStart(startTime, endTime)) {
    throw new AppError(400, "endTime must be later than startTime.");
  }

  // ── Rules 1 & 2: fetch same-day faculty/room slots, then overlap-test them.
  //
  // IMPORTANT: this runs BEFORE the faculty-assignment check below. A double
  // -booking (409 Conflict) is a more fundamental problem than a missing
  // assignment (400 Bad Request), and it must win when both are true.
  // Previously the assignment check ran first, so a ROOM clash caused by a
  // second faculty who simply didn't have a FacultyAssignment row yet would
  // be reported as 400 "not assigned" instead of 409 "room already booked" —
  // hiding the real conflict. Checking conflicts first fixes that.
  //
  // Built-in used: prisma query via repo.findConflictCandidates (see
  // timetables.repository.js) — it returns every existing slot on the same
  // day, in the same session, that shares this faculty OR this classroom.
  const candidates = await repo.findConflictCandidates({
    schoolId,
    sessionId: timetable.sessionId,
    dayOfWeek,
    facultyId,
    classroom,
    excludeSlotId,
  });

  for (const other of candidates) {
    // timesOverlap (src/utils/time.js) returns true only if the two time
    // ranges actually intersect — back-to-back classes (10:00-11:00 and
    // 11:00-12:00) do NOT count as a clash, so skip non-overlapping ones.
    if (!timesOverlap(startTime, endTime, other.startTime, other.endTime)) {
      continue;
    }
    // It overlaps — report which kind of clash it is.
    if (other.facultyId === facultyId) {
      throw new AppError(
        409,
        "This faculty already has another class at this day and time.",
      );
    }
    if (other.classroom === classroom) {
      // Room clash must be a 409 Conflict (not 400) — this is a scheduling
      // conflict with existing data, not a bad request from the client.
      throw new AppError(
        409,
        "Room conflict: classroom already booked at this time",
      );
    }
  }

  // ── Rule 3: faculty must be assigned to this subject for this session+batch.
  // Same gate used in Phase 1 faculty assignment — a slot can't invent a
  // teaching duty that was never assigned.
  //
  // Built-in used: prisma.facultyAssignment.findFirst({ where, select })
  // looks up one matching row (or null) — we only need to know if it exists,
  // so `select: { id: true }` avoids fetching columns we won't use.
  const assignment = await prisma.facultyAssignment.findFirst({
    where: {
      schoolId,
      sessionId: timetable.sessionId,
      facultyId,
      subjectId,
      batchYear: timetable.batchYear,
    },
    select: { id: true },
  });
  if (!assignment) {
    throw new AppError(
      400,
      "This faculty is not assigned to teach this subject for this session " +
        "and batch. Create the faculty assignment first.",
    );
  }
}

/**
 * addSlot — HOD adds one class block to a timetable.
 * Order: cheap shape checks first, then the more expensive DB conflict checks.
 */
async function addSlot(timetableId, schoolId, body) {
  const timetable = await getTimetableOr404(parseInt(timetableId), schoolId);
  assertEditable(timetable);

  validateSlotShape(body, false);

  const subjectId = parseInt(body.subjectId);
  const facultyId = parseInt(body.facultyId);
  const dayOfWeek = parseInt(body.dayOfWeek);
  const { startTime, endTime, classroom } = body;
  const slotType = body.slotType || "lecture"; // default when not provided

  await assertNoConflicts({
    schoolId, timetable, subjectId, facultyId,
    dayOfWeek, startTime, endTime, classroom,
  });

  const slot = await repo.createSlot({
    schoolId,
    timetableId: timetable.id,
    subjectId,
    facultyId,
    dayOfWeek,
    startTime,
    endTime,
    classroom,
    slotType,
  });

  await invalidate(`tt:${schoolId}`);

  return slot;
}

/**
 * updateSlot — HOD edits a slot. Only the fields sent are changed; we then
 * re-run conflict checks on the MERGED values (old + new), ignoring this slot.
 */
async function updateSlot(timetableId, slotId, schoolId, body) {
  const tId = parseInt(timetableId);
  const sId = parseInt(slotId);

  const timetable = await getTimetableOr404(tId, schoolId);
  assertEditable(timetable);

  const existing = await repo.findSlotById(sId, schoolId);
  // Make sure the slot exists AND belongs to the timetable in the URL.
  if (!existing || existing.timetableId !== tId) {
    throw new AppError(404, "Slot not found in this timetable.");
  }

  validateSlotShape(body, true);

  // Merge: use the new value when provided, otherwise keep the existing one.
  const merged = {
    subjectId: body.subjectId !== undefined ? parseInt(body.subjectId) : existing.subjectId,
    facultyId: body.facultyId !== undefined ? parseInt(body.facultyId) : existing.facultyId,
    dayOfWeek: body.dayOfWeek !== undefined ? parseInt(body.dayOfWeek) : existing.dayOfWeek,
    startTime: body.startTime !== undefined ? body.startTime : existing.startTime,
    endTime:   body.endTime   !== undefined ? body.endTime   : existing.endTime,
    classroom: body.classroom !== undefined ? body.classroom : existing.classroom,
    slotType:  body.slotType  !== undefined ? body.slotType  : existing.slotType,
  };

  await assertNoConflicts({
    schoolId,
    timetable,
    subjectId: merged.subjectId,
    facultyId: merged.facultyId,
    dayOfWeek: merged.dayOfWeek,
    startTime: merged.startTime,
    endTime: merged.endTime,
    classroom: merged.classroom,
    excludeSlotId: sId, // don't let a slot clash with itself
  });

  await repo.updateSlot(sId, schoolId, merged);
  await invalidate(`tt:${schoolId}`);
  return repo.findSlotById(sId, schoolId);
}

/**
 * deleteSlot — HOD removes a slot (draft/returned only).
 */
async function deleteSlot(timetableId, slotId, schoolId) {
  const tId = parseInt(timetableId);
  const sId = parseInt(slotId);

  const timetable = await getTimetableOr404(tId, schoolId);
  assertEditable(timetable);

  const existing = await repo.findSlotById(sId, schoolId);
  if (!existing || existing.timetableId !== tId) {
    throw new AppError(404, "Slot not found in this timetable.");
  }

  await repo.deleteSlot(sId, schoolId);
  await invalidate(`tt:${schoolId}`);
  return { message: "Slot removed." };
}

// =============================================================================
// SUBMIT / RESUBMIT  (HOD → Admin)
// =============================================================================

/**
 * moveToSubmitted — shared logic for submit and resubmit. Moves the timetable
 * to "submitted", stamps the time, clears any old return comment, and notifies
 * every admin so any of them can review.
 *
 * @param {Object} timetable   already-loaded timetable
 * @param {number} schoolId
 * @param {string[]} allowedFrom  statuses this transition is valid from
 */
async function moveToSubmitted(timetable, schoolId, allowedFrom) {
  if (!allowedFrom.includes(timetable.status)) {
    throw new AppError(
      400,
      `Cannot submit a timetable that is "${timetable.status}".`,
    );
  }

  await repo.updateTimetable(timetable.id, schoolId, {
    status: "submitted",
    submittedAt: new Date(), // new Date() = the current date/time
    adminComment: null,
  });

  const adminIds = await getAdminUserIds(schoolId);
  if (adminIds.length) {
    // Wrapped in try/catch so a notification failure never breaks the response.
    try {
      await notifyMany(
        adminIds,
        NOTIFICATION_TYPES.TIMETABLE_SUBMITTED,
        `A timetable for batch ${timetable.batchYear}, semester ` +
          `${timetable.semesterNumber} has been submitted for approval.`,
        "/admin/timetables",
      );
    } catch (err) {
      console.error("Failed to send TIMETABLE_SUBMITTED notification:", err);
    }
  }

  await invalidate(`tt:${schoolId}`);

  return repo.findById(timetable.id, schoolId);
}

/**
 * submitTimetable — HOD submits a draft for admin approval.
 */
async function submitTimetable(id, schoolId) {
  const timetable = await getTimetableOr404(parseInt(id), schoolId);
  return moveToSubmitted(timetable, schoolId, ["draft"]);
}

/**
 * resubmitTimetable — HOD resubmits after fixing a returned timetable.
 */
async function resubmitTimetable(id, schoolId) {
  const timetable = await getTimetableOr404(parseInt(id), schoolId);
  return moveToSubmitted(timetable, schoolId, ["returned"]);
}

// =============================================================================
// ADMIN WORKFLOW  (approve / return)
// =============================================================================

/**
 * getSubmittedTimetables — admin sees all submitted timetables (oldest first).
 */
async function getSubmittedTimetables(schoolId) {
  return cached(
    `tt:${schoolId}:submitted`,
    null,
    () => repo.findAllByStatus(schoolId, "submitted"),
    `tt:${schoolId}`
  );
}

/**
 * approveTimetable — admin approves a submitted timetable; it becomes the live
 * schedule. Notifies the department's HOD.
 *
 * @param {number} id
 * @param {number} schoolId
 * @param {number} adminUserId  the approving admin (stored as reviewer)
 */
async function approveTimetable(id, schoolId, adminUserId) {
  const timetable = await getTimetableOr404(parseInt(id), schoolId);

  if (timetable.status !== "submitted") {
    throw new AppError(
      400,
      `Only submitted timetables can be approved (current: "${timetable.status}").`,
    );
  }

  await repo.updateTimetable(timetable.id, schoolId, {
    status: "approved",
    approvedAt: new Date(),
    reviewedByAdminId: adminUserId,
    adminComment: null,
  });

  const hodUserId = await getHodUserId(timetable.departmentId, schoolId);
  if (hodUserId) {
    try {
      await notify(
        hodUserId,
        NOTIFICATION_TYPES.TIMETABLE_APPROVED,
        `Your timetable for batch ${timetable.batchYear}, semester ` +
          `${timetable.semesterNumber} has been approved.`,
        "/timetables",
      );
    } catch (err) {
      console.error("Failed to send TIMETABLE_APPROVED notification:", err);
    }
  }

  await invalidate(`tt:${schoolId}`);

  return repo.findById(timetable.id, schoolId);
}

/**
 * returnTimetable — admin sends a timetable back for corrections with a
 * required comment. Status becomes "returned", which re-opens slot editing.
 *
 * @param {number} id
 * @param {number} schoolId
 * @param {number} adminUserId
 * @param {string} comment  reason for return (required)
 */
async function returnTimetable(id, schoolId, adminUserId, comment) {
  // trim() removes surrounding spaces so " " doesn't count as a real comment.
  if (!comment || !comment.trim()) {
    throw new AppError(400, "A comment is required when returning a timetable.");
  }

  const timetable = await getTimetableOr404(parseInt(id), schoolId);

  if (timetable.status !== "submitted") {
    throw new AppError(
      400,
      `Only submitted timetables can be returned (current: "${timetable.status}").`,
    );
  }

  await repo.updateTimetable(timetable.id, schoolId, {
    status: "returned",
    reviewedByAdminId: adminUserId,
    adminComment: comment.trim(),
  });

  const hodUserId = await getHodUserId(timetable.departmentId, schoolId);
  if (hodUserId) {
    try {
      await notify(
        hodUserId,
        NOTIFICATION_TYPES.TIMETABLE_RETURNED,
        `Your timetable for batch ${timetable.batchYear}, semester ` +
          `${timetable.semesterNumber} was returned: ${comment.trim()}`,
        "/timetables",
      );
    } catch (err) {
      console.error("Failed to send TIMETABLE_RETURNED notification:", err);
    }
  }

  await invalidate(`tt:${schoolId}`);

  return repo.findById(timetable.id, schoolId);
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  createTimetable,
  getDepartmentTimetables,
  getTimetableById,
  setDepartmentTimetableDocument,
  getDepartmentTimetableDocument,
  updateTimetable,
  addSlot,
  updateSlot,
  deleteSlot,
  submitTimetable,
  resubmitTimetable,
  getSubmittedTimetables,
  approveTimetable,
  returnTimetable,
};
