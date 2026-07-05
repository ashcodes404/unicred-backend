/**
 * ANNOUNCEMENT REPOSITORY
 * =========================================================================
 * All direct Prisma calls for announcements live here. announcement.service.js
 * calls these functions — it never talks to Prisma directly (same
 * repository/service split used everywhere else in this app, e.g.
 * syllabus.service.js / syllabus.repository.js).
 *
 * Three kinds of functions in this file:
 *   1. Writes          — createWithRecipients()
 *   2. Audience lookups — findSchoolWideRecipients() / findDepartmentRecipients() /
 *                         findFacultyStudentRecipients() — figure out WHO should
 *                         receive a new announcement, grouped by role (so the
 *                         service can send each role group to its own
 *                         "/<role>/announcements/:id" notification link).
 *   3. Reads           — findVisibleToUser() / findByIdForUser() — what the
 *                         logged-in user is allowed to see.
 */

const prisma = require("../../config/db");

// ── Writes ────────────────────────────────────────────────────────────────

/**
 * WHAT: Creates the Announcement row AND its AnnouncementRecipient rows
 *       together, inside one database transaction.
 * WHY: An announcement with no matching recipient rows would be invisible
 *      to everyone it was supposed to reach — a real correctness bug, not
 *      just a missed notification. Same reasoning registration.repository.js
 *      already uses for School+User+Payment: either everything here commits
 *      together, or (if anything throws) Prisma rolls all of it back and no
 *      half-written announcement is left behind.
 *
 * @param {object} data - { schoolId, senderUserId, scope, departmentId, sessionId, title, content, expiresAt }
 * @param {number[]} recipientUserIds - every userId who should see this announcement
 * RETURNS: Promise<Announcement>
 */
async function createWithRecipients(data, recipientUserIds) {
  // prisma.$transaction(async (tx) => {...}) opens one database transaction —
  // every query made through `tx` either all succeed together, or (if the
  // callback throws) Prisma automatically undoes all of them.
  return prisma.$transaction(async (tx) => {
    const announcement = await tx.announcement.create({ data });

    if (recipientUserIds.length) {
      // createMany() inserts every row in ONE query instead of one round-trip
      // per recipient — the same bulk-insert approach notifyMany() uses.
      // skipDuplicates guards against the same userId appearing twice in
      // recipientUserIds (shouldn't happen, but costs nothing to be safe).
      await tx.announcementRecipient.createMany({
        data: recipientUserIds.map((userId) => ({ announcementId: announcement.id, userId })),
        skipDuplicates: true,
      });
    }

    return announcement;
  });
}

// ── Audience lookups ─────────────────────────────────────────────────────

/**
 * WHAT: Every HOD, Faculty, and Student in a school — grouped by role.
 * WHY: Powers an ADMIN's school-wide announcement. Grouped by role (rather
 *      than one flat list) so the service can notify each group with a link
 *      to ITS OWN announcements page (/hod/..., /faculty/..., /student/...).
 * @param {number} schoolId
 * @param {number} excludeUserId - the admin who's creating this, never their own recipient
 * RETURNS: Promise<{hodUserIds:number[], facultyUserIds:number[], studentUserIds:number[]}>
 */
async function findSchoolWideRecipients(schoolId, excludeUserId) {
  const users = await prisma.user.findMany({
    where: {
      schoolId,
      role: { in: ["hod", "faculty", "student"] },
      id: { not: excludeUserId },
      deletedAt: null,
    },
    select: { id: true, role: true },
  });

  return {
    hodUserIds: users.filter((u) => u.role === "hod").map((u) => u.id),
    facultyUserIds: users.filter((u) => u.role === "faculty").map((u) => u.id),
    studentUserIds: users.filter((u) => u.role === "student").map((u) => u.id),
  };
}

/**
 * WHAT: Every Faculty and Student in ONE department.
 * WHY: Powers a HOD's department-wide announcement. Mirrors the exact same
 *      query syllabus.service.js's notifyDepartmentOfSyllabus() already uses —
 *      `userId: { not: excludeUserId }` on the faculty side excludes the HOD
 *      themselves (a HOD has their own Faculty row in their department, since
 *      HOD routes already resolve departmentId through that same row via
 *      facultyContext.middleware.js).
 * @param {number} schoolId
 * @param {number} departmentId
 * @param {number} excludeUserId - the HOD who's creating this
 * RETURNS: Promise<{facultyUserIds:number[], studentUserIds:number[]}>
 */
async function findDepartmentRecipients(schoolId, departmentId, excludeUserId) {
  const [faculty, students] = await Promise.all([
    prisma.faculty.findMany({
      where: { schoolId, departmentId, deletedAt: null, userId: { not: excludeUserId } },
      select: { userId: true },
    }),
    prisma.student.findMany({
      where: { schoolId, departmentId, deletedAt: null },
      select: { userId: true },
    }),
  ]);

  return {
    facultyUserIds: faculty.map((f) => f.userId),
    studentUserIds: students.map((s) => s.userId),
  };
}

/**
 * WHAT: Every distinct (batchYear, semesterNumber) pair this faculty has an
 *       assignment for, in one academic session.
 * WHY: A faculty can be assigned more than one subject — sometimes to the
 *      same batch/semester, sometimes to different ones — so we need the
 *      full, de-duplicated set before looking up which students match any
 *      of them.
 * @param {number} schoolId
 * @param {number} facultyId
 * @param {number} sessionId - the department's currently ACTIVE session only
 * RETURNS: Promise<Array<{batchYear:number, semesterNumber:number}>>
 */
async function findFacultyAssignmentPairs(schoolId, facultyId, sessionId) {
  const assignments = await prisma.facultyAssignment.findMany({
    where: { schoolId, facultyId, sessionId },
    select: { batchYear: true, semesterNumber: true },
  });

  // Map keyed by "batchYear-semesterNumber" — using a Map (not a plain
  // object) as a quick way to drop duplicate pairs, since Map keys are
  // naturally unique. .values() then gives back just the de-duplicated pairs.
  const uniquePairs = new Map(assignments.map((a) => [`${a.batchYear}-${a.semesterNumber}`, a]));
  return [...uniquePairs.values()];
}

/**
 * WHAT: Every student registered for a session under ANY of the given
 *       (batchYear, semesterNumber) pairs.
 * WHY: This is the same "who's actually in this class" lookup
 *      results.repository.js's getRegisteredStudentIds() uses for the
 *      mark-entry roster — StudentSessionRegistration is the source of truth
 *      for "which students are in batch X, semester Y this session", not
 *      Student.currentSemester (which only reflects their MOST RECENT
 *      registration, not this specific session's).
 * @param {number} schoolId
 * @param {number} sessionId
 * @param {Array<{batchYear:number, semesterNumber:number}>} pairs
 * RETURNS: Promise<number[]> - Student.userId values (deduplicated)
 */
async function findRegisteredStudentUserIds(schoolId, sessionId, pairs) {
  if (!pairs.length) return [];

  const registrations = await prisma.studentSessionRegistration.findMany({
    where: {
      schoolId,
      sessionId,
      // OR: an array of exact {batchYear, semesterNumber} pairs — a student
      // matches if they're registered under ANY one of them.
      OR: pairs.map(({ batchYear, semesterNumber }) => ({ batchYear, semesterNumber })),
    },
    include: { student: { select: { userId: true } } },
  });

  // Set() drops duplicates — a student could theoretically match more than
  // one pair (e.g. registered under a batch/semester combo appearing twice
  // across different subject assignments).
  return [...new Set(registrations.map((r) => r.student.userId))];
}

// ── Reads ────────────────────────────────────────────────────────────────

// Shared `include` for every list/detail read below — keeps the shape of an
// announcement row identical everywhere it's returned.
const ANNOUNCEMENT_INCLUDE = {
  sender: { select: { id: true, name: true, role: true } },
  department: { select: { id: true, name: true } },
  _count: { select: { recipients: true } },
};

/**
 * WHAT: Every announcement a user is allowed to see — either because they
 *       SENT it, or because they're a RECIPIENT of it.
 * WHY: One query serves every role. Admin/HOD/Faculty naturally see
 *      "sent + received" because they can match either half of the OR;
 *      Students only ever match the "recipient" half (they can never be a
 *      sender), so they transparently only ever see received announcements —
 *      no separate query or branch needed.
 * @param {number} schoolId
 * @param {number} userId
 * @param {{skip:number, limit:number}} pageInfo
 * RETURNS: Promise<{rows:Announcement[], total:number}>
 */
async function findVisibleToUser(schoolId, userId, { skip, limit }) {
  const where = {
    schoolId,
    OR: [{ senderUserId: userId }, { recipients: { some: { userId } } }],
    // Hide expired announcements from the everyday list — an "Expires on"
    // date the sender picked should actually mean something, otherwise it's
    // a field that quietly does nothing (confusing for the sender, and
    // recipients keep seeing stale notices forever). The single-announcement
    // detail view (findByIdForUser, below) deliberately does NOT apply this
    // filter, so an old notification link still opens correctly.
    AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
  };

  // Run the page query and the total count at the same time — they don't
  // depend on each other, so there's no reason to wait for one before
  // starting the other (same parallel-query pattern subscription.service.js's
  // getHistory() already uses).
  const [rows, total] = await Promise.all([
    prisma.announcement.findMany({
      where,
      include: ANNOUNCEMENT_INCLUDE,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.announcement.count({ where }),
  ]);

  return { rows, total };
}

/**
 * WHAT: One announcement, only if the user is allowed to see it (sender or recipient).
 * WHY: Powers the single-announcement detail view. Returns null (not a raw
 *      Prisma error) if the id doesn't exist OR the user isn't allowed to
 *      see it — the service turns that into a clean 404, never leaking
 *      whether the id exists at all to someone who shouldn't see it.
 * @param {number} id
 * @param {number} schoolId
 * @param {number} userId
 * RETURNS: Promise<Announcement|null>
 */
async function findByIdForUser(id, schoolId, userId) {
  return prisma.announcement.findFirst({
    where: {
      id,
      schoolId,
      OR: [{ senderUserId: userId }, { recipients: { some: { userId } } }],
    },
    include: ANNOUNCEMENT_INCLUDE,
  });
}

module.exports = {
  createWithRecipients,
  findSchoolWideRecipients,
  findDepartmentRecipients,
  findFacultyAssignmentPairs,
  findRegisteredStudentUserIds,
  findVisibleToUser,
  findByIdForUser,
};
