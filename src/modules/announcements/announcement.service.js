/**
 * ANNOUNCEMENT SERVICE
 * =========================================================================
 * Business rules for announcements:
 *   - ADMIN sends to the whole school (every HOD + Faculty + Student).
 *   - HOD sends to their own department only (Faculty + Students there).
 *   - FACULTY sends only to students they currently teach — resolved from
 *     their FacultyAssignment(s) in their department's ACTIVE academic
 *     session (subject + batch + semester), never from the whole department.
 *   - STUDENT can only ever view (enforced entirely by the routes/middleware
 *     — there is no "create" function here for students to call).
 *
 * schoolId is ALWAYS taken from req.user (the JWT) by the controller, never
 * from the request body — same multi-tenancy rule tenant.middleware.js
 * documents for every other module in this app.
 */

const repo = require("./announcement.repository");
const academicSessionsRepo = require("../academic-sessions/academic-sessions.repository");
const AppError = require("../../utils/AppError");
const { notifyMany } = require("../../utils/notify");
const NOTIFICATION_TYPES = require("../../constants/notificationTypes");
const { parsePagination, buildPaginationMeta } = require("../../utils/pagination");

// The audienceType values each sender role is allowed to pick — deliberately
// the SAME strings as the AnnouncementScope enum (prisma/schema.prisma), so
// the value the client sends can be used directly as `scope` with no
// separate mapping table to keep in sync.
const ADMIN_AUDIENCE_TYPES = ["school", "hods", "faculty", "students"];
const HOD_AUDIENCE_TYPES = ["department", "faculty", "students"];

// Hard caps on title/content length — production hardening: without these,
// nothing stopped a client (buggy or malicious) from posting a multi-megabyte
// "announcement" that bloats the database and the Notification rows/pages
// that reference it. Mirrored on the frontend (AnnouncementsPage.jsx) so a
// user sees the limit before submitting, not after a 400 comes back.
const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 5000;

/**
 * WHAT: Figures out WHO an announcement should reach. The sender's ROLE
 *       decides which audienceType values are even legal to pick (checked
 *       against ADMIN_AUDIENCE_TYPES/HOD_AUDIENCE_TYPES below) — the CLIENT
 *       only ever narrows within what their role is already allowed to
 *       reach, never outside it.
 * WHY: This is the single place that decides audience-per-role, so the
 *      controller/routes only need to know WHICH roles are allowed to hit
 *      the create endpoint at all (requireRole("admin","hod","faculty")) —
 *      the actual "how big is their reach" logic lives in exactly one spot.
 *
 * @param {{userId:number, role:string, schoolId:number}} user - req.user from the JWT
 * @param {{id:number, departmentId:number}|null} faculty - req.faculty, for hod/faculty senders (see facultyContext.middleware.js)
 * @param {string} [audienceType] - client's pick; required for admin/hod, ignored for faculty
 * @returns {Promise<{scope:string, departmentId:number|null, sessionId:number|null, recipients:object}>}
 *          `recipients` is grouped by role — see announcement.repository.js's
 *          findSchoolWideRecipients() for the exact shape.
 */
async function resolveAudience(user, faculty, audienceType) {
  if (user.role === "admin") {
    if (!ADMIN_AUDIENCE_TYPES.includes(audienceType)) {
      throw new AppError(400, `"Announce to" must be one of: ${ADMIN_AUDIENCE_TYPES.join(", ")}.`);
    }

    // One lookup returns all three groups already split out by role (see
    // findSchoolWideRecipients) — picking a narrower audienceType just means
    // keeping fewer of those groups, not a different query.
    const all = await repo.findSchoolWideRecipients(user.schoolId, user.userId);
    const recipients =
      audienceType === "school" ? all
      : audienceType === "hods" ? { hodUserIds: all.hodUserIds }
      : audienceType === "faculty" ? { facultyUserIds: all.facultyUserIds }
      : { studentUserIds: all.studentUserIds }; // "students"

    return { scope: audienceType, departmentId: null, sessionId: null, recipients };
  }

  if (user.role === "hod") {
    if (!HOD_AUDIENCE_TYPES.includes(audienceType)) {
      throw new AppError(400, `"Announce to" must be one of: ${HOD_AUDIENCE_TYPES.join(", ")}.`);
    }

    const all = await repo.findDepartmentRecipients(user.schoolId, faculty.departmentId, user.userId);
    const recipients =
      audienceType === "department" ? all
      : audienceType === "faculty" ? { facultyUserIds: all.facultyUserIds }
      : { studentUserIds: all.studentUserIds }; // "students"

    return { scope: audienceType, departmentId: faculty.departmentId, sessionId: null, recipients };
  }

  if (user.role === "faculty") {
    // "Currently teaching" only makes sense within the department's ACTIVE
    // session — findActiveSession() already enforces "at most one active
    // session per department" elsewhere, so this is a well-defined single lookup.
    const activeSession = await academicSessionsRepo.findActiveSession(user.schoolId, faculty.departmentId);
    if (!activeSession) {
      throw new AppError(
        400,
        "There is no active academic session for your department right now, so you have no current students to announce to."
      );
    }

    const pairs = await repo.findFacultyAssignmentPairs(user.schoolId, faculty.id, activeSession.id);
    const studentUserIds = await repo.findRegisteredStudentUserIds(user.schoolId, activeSession.id, pairs);

    if (!studentUserIds.length) {
      throw new AppError(400, "You have no currently assigned students to announce to.");
    }

    return {
      scope: "students",
      departmentId: faculty.departmentId,
      sessionId: activeSession.id,
      recipients: { studentUserIds },
    };
  }

  // requireRole() on the route already blocks every other role from getting
  // this far — this is just a safety net in case that ever changes.
  throw new AppError(403, "You are not allowed to create announcements.");
}

/**
 * WHAT: Sends one "you have a new announcement" notification to every
 *       recipient, grouped by role so each group's link points at THEIR
 *       OWN announcements page.
 * WHY: notify.js's notifyMany() takes one link for a whole batch — since
 *      HODs/Faculty/Students each have a different announcements ROUTE
 *      (/hod/..., /faculty/..., /student/...), each role group needs its
 *      own notifyMany() call. Wrapped in try/catch (same convention
 *      timetables.service.js uses) so a notification hiccup can never
 *      undo or fail the "announcement created" response — the announcement
 *      itself is already saved and visible either way.
 *
 * @param {object} recipients - { hodUserIds?, facultyUserIds?, studentUserIds? }
 * @param {number} announcementId
 * @param {string} title
 */
async function notifyRecipients(recipients, announcementId, title) {
  const message = `New announcement: "${title}"`;
  try {
    if (recipients.hodUserIds?.length) {
      await notifyMany(recipients.hodUserIds, NOTIFICATION_TYPES.ANNOUNCEMENT_POSTED, message, `/hod/announcements/${announcementId}`);
    }
    if (recipients.facultyUserIds?.length) {
      await notifyMany(recipients.facultyUserIds, NOTIFICATION_TYPES.ANNOUNCEMENT_POSTED, message, `/faculty/announcements/${announcementId}`);
    }
    if (recipients.studentUserIds?.length) {
      await notifyMany(recipients.studentUserIds, NOTIFICATION_TYPES.ANNOUNCEMENT_POSTED, message, `/student/announcements/${announcementId}`);
    }
  } catch (err) {
    console.error("Failed to send ANNOUNCEMENT_POSTED notifications:", err);
  }
}

/**
 * WHAT: Creates a new announcement and notifies its whole audience.
 * WHY: Powers POST /api/announcements for admin/hod/faculty senders.
 *
 * @param {{userId:number, role:string, schoolId:number}} user - req.user
 * @param {{id:number, departmentId:number}|null} faculty - req.faculty (null for admin senders)
 * @param {{title:string, content:string, expiresAt?:string, audienceType?:string}} body
 * RETURNS: Promise<Announcement>
 */
async function createAnnouncement(user, faculty, body) {
  const title = body.title?.trim();
  const content = body.content?.trim();
  if (!title) throw new AppError(400, "Title is required.");
  if (!content) throw new AppError(400, "Content is required.");
  if (title.length > MAX_TITLE_LENGTH) {
    throw new AppError(400, `Title must be ${MAX_TITLE_LENGTH} characters or fewer.`);
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    throw new AppError(400, `Content must be ${MAX_CONTENT_LENGTH} characters or fewer.`);
  }

  // expiresAt is optional, but if it's given it must be a real, FUTURE date —
  // `new Date("garbage")` silently produces an "Invalid Date" object that
  // Prisma would only reject once it hits the database (a confusing 500,
  // not a clean 400), and a past date would just make the announcement
  // start out already-expired.
  let expiresAt = null;
  if (body.expiresAt) {
    const parsed = new Date(body.expiresAt);
    if (Number.isNaN(parsed.getTime())) {
      throw new AppError(400, "expiresAt must be a valid date.");
    }
    if (parsed.getTime() <= Date.now()) {
      throw new AppError(400, "expiresAt must be in the future.");
    }
    expiresAt = parsed;
  }

  const { scope, departmentId, sessionId, recipients } = await resolveAudience(user, faculty, body.audienceType);

  // Flatten every role group into one plain array for the recipient rows —
  // AnnouncementRecipient doesn't care WHICH role a user has, only that they
  // should see this announcement. The unique index on
  // [announcementId, userId] means a stray duplicate here can never double-insert.
  const recipientUserIds = [
    ...(recipients.hodUserIds ?? []),
    ...(recipients.facultyUserIds ?? []),
    ...(recipients.studentUserIds ?? []),
  ];

  // A narrower audienceType (e.g. admin picking "All HODs" when the school
  // has none) can legitimately resolve to zero people — better to say so
  // clearly than silently create an announcement nobody will ever see.
  // (Faculty's "no current students" case already throws its own more
  // specific message earlier, inside resolveAudience, so it never reaches here.)
  if (!recipientUserIds.length) {
    throw new AppError(400, "No recipients match this audience — nothing to announce to.");
  }

  const announcement = await repo.createWithRecipients(
    {
      schoolId: user.schoolId,
      senderUserId: user.userId,
      scope,
      departmentId,
      sessionId,
      title,
      content,
      expiresAt,
    },
    recipientUserIds
  );

  await notifyRecipients(recipients, announcement.id, title);

  return announcement;
}

/**
 * WHAT: Paginated list of announcements the logged-in user can see
 *       (sent + received for admin/hod/faculty; received-only for students —
 *       see announcement.repository.js's findVisibleToUser() for why no
 *       role branch is needed here).
 * WHY: Powers GET /api/announcements.
 *
 * @param {{userId:number, schoolId:number}} user
 * @param {object} query - req.query, e.g. { page, limit }
 * RETURNS: Promise<{rows:Announcement[], pagination:object}>
 */
async function listForUser(user, query) {
  const { page, limit, skip } = parsePagination(query);
  const { rows, total } = await repo.findVisibleToUser(user.schoolId, user.userId, { skip, limit });
  return { rows, pagination: buildPaginationMeta(page, limit, total) };
}

/**
 * WHAT: One announcement's full detail, only if the user is allowed to see it.
 * WHY: Powers GET /api/announcements/:id.
 *
 * @param {number} id
 * @param {{userId:number, schoolId:number}} user
 * RETURNS: Promise<Announcement>
 */
async function getByIdForUser(id, user) {
  // Number("abc") is NaN, which Prisma would reject with an internal
  // validation error (an ugly 500) rather than a clean 4xx — catch that
  // here first. A non-existent-but-numeric id still correctly falls
  // through to the normal 404 below.
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw new AppError(400, "Invalid announcement id.");
  }

  const announcement = await repo.findByIdForUser(numericId, user.schoolId, user.userId);
  if (!announcement) {
    throw new AppError(404, "Announcement not found.");
  }
  return announcement;
}

module.exports = {
  createAnnouncement,
  listForUser,
  getByIdForUser,
};
