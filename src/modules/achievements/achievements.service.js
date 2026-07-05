//src/modules/achievements/achievements.service.js

// =============================================================================
// ACHIEVEMENTS SERVICE  (multi-faculty / Option B)
// =============================================================================
//
// Flow in plain words:
//   1. Student creates an achievement and picks one OR MANY faculties.
//      -> one Achievement row + one AchievementReview row per chosen faculty.
//   2. Each chosen faculty sees ONLY achievements sent to them and records
//      their OWN verdict (approve = optional remark, reject = remark required).
//   3. The achievement's overall status is a ROLLUP of those verdicts:
//        - approved : the moment ANY one faculty approves
//        - rejected : only when EVERY assigned faculty has rejected
//        - pending  : otherwise
//
// Transactions: like results.service.js, this service imports prisma directly
// for the multi-row writes so a write + its rollup happen atomically.
// =============================================================================

const prisma          = require("../../config/db");
const repo            = require("./achievements.repository");
const facultyRepo     = require("../faculty/faculty.repository");
const sessionRepo     = require("../academic-sessions/academic-sessions.repository");
const AppError        = require("../../utils/AppError");
const { notify, notifyMany } = require("../../utils/notify");
const NOTIFICATION_TYPES = require("../../constants/notificationTypes");
const { isNonEmptyString, isValidUrl } = require("../../utils/validators");

// Notification deep-links must point at REAL frontend routes, and those
// differ by recipient role:
//   - faculty/HOD reviewers open the review screen
//   - the owning student opens their own achievement detail
const FACULTY_REVIEW_LINK      = (id) => `/faculty/achievements/${id}/review`;
const STUDENT_ACHIEVEMENT_LINK = (id) => `/student/achievements/${id}`;

// -----------------------------------------------------------------------------
// Small pure helpers
// -----------------------------------------------------------------------------

/** Turn ?page&limit into safe numbers (defaults 1/20, limit capped at 100). */
function parsePagination(query = {}) {
  let page  = Number(query.page);
  let limit = Number(query.limit);
  if (Number.isNaN(page)  || page  < 1) page  = 1;
  if (Number.isNaN(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100;
  return { page, limit, skip: (page - 1) * limit };
}

/** Standard paginated wrapper (same shape as the other modules). */
function paginate(items, page, limit, total) {
  return {
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/**
 * THE ROLLUP RULE (unanimous approval). Given every per-faculty review,
 * decide the achievement's overall status.
 *   - any one rejected           -> "rejected"
 *     (a single reject makes unanimous approval impossible, so it's settled)
 *   - at least one review AND
 *     every review approved       -> "approved"
 *   - otherwise                   -> "pending"
 *     (still waiting on one or more assigned reviewers)
 *
 * @param {Array<{status:string}>} reviews
 * @returns {"approved"|"rejected"|"pending"}
 */
function computeOverallStatus(reviews) {
  if (reviews.length === 0) return "pending";
  if (reviews.some((r) => r.status === "rejected")) return "rejected";
  if (reviews.every((r) => r.status === "approved")) return "approved";
  return "pending";
}

/**
 * Clean a raw facultyIds input into a list of unique positive integers.
 * Throws 400 if the shape is wrong or empty.
 */
function normalizeFacultyIds(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new AppError(400, "facultyIds must be a non-empty array.");
  }
  const ids = [...new Set(raw.map((x) => Number(x)))]; // dedupe + to number
  if (ids.some((n) => !Number.isInteger(n) || n < 1)) {
    throw new AppError(400, "facultyIds must contain valid faculty ids.");
  }
  return ids;
}

/**
 * Verify every id is a real faculty in this school, returning their User ids
 * (needed to notify them). Throws 404 naming the first id that isn't valid.
 *
 * @returns {Promise<number[]>} list of faculty.user.id
 */
async function resolveFacultyUserIds(facultyIds, schoolId) {
  const userIds = [];
  for (const fid of facultyIds) {
    const faculty = await facultyRepo.findById(fid, schoolId);
    if (!faculty) {
      throw new AppError(404, `Faculty ${fid} not found in your school.`);
    }
    userIds.push(faculty.user.id);
  }
  return userIds;
}

// =============================================================================
// STUDENT ACTIONS
// =============================================================================

/**
 * Create an achievement and send it to one or many faculties.
 *
 * Validations:
 *   1. title, category required
 *   2. facultyIds = non-empty array of real faculties in this school
 *   3. certificateUrl / proofUrl, if sent, must be valid http(s) URLs
 *   4. sessionId, if sent, must be a real session in this school
 */
async function createAchievement(student, body) {
  const {
    title, category, description,
    certificateUrl, proofUrl, sessionId, facultyIds,
  } = body;

  if (!isNonEmptyString(title) || !isNonEmptyString(category)) {
    throw new AppError(400, "title and category are required.");
  }
  if (certificateUrl !== undefined && !isValidUrl(certificateUrl)) {
    throw new AppError(400, "certificateUrl must be a valid http(s) URL.");
  }
  if (proofUrl !== undefined && !isValidUrl(proofUrl)) {
    throw new AppError(400, "proofUrl must be a valid http(s) URL.");
  }

  // Resolve + validate the chosen faculties (any department, same school).
  const ids = normalizeFacultyIds(facultyIds);
  const facultyUserIds = await resolveFacultyUserIds(ids, student.schoolId);

  // Optional session check.
  if (sessionId !== undefined && sessionId !== null) {
    const session = await sessionRepo.findByIdForAnyRole(Number(sessionId), student.schoolId);
    if (!session) throw new AppError(404, "Academic session not found.");
  }

  // Atomic: create the achievement AND one review row per faculty together.
  // If any insert fails, the whole thing rolls back (no half-created records).
  const created = await prisma.$transaction(async (tx) => {
    const achievement = await tx.achievement.create({
      data: {
        studentId:      student.id,
        title:          title.trim(),
        category:       category.trim(),
        description:    isNonEmptyString(description) ? description.trim() : null,
        certificateUrl: certificateUrl ?? null,
        proofUrl:       proofUrl ?? null,
        sessionId:      sessionId ? Number(sessionId) : null,
        // status defaults to "pending"; verifiedBy stays null until rollup.
      },
      select: { id: true },
    });

    await tx.achievementReview.createMany({
      data: ids.map((facultyId) => ({
        achievementId: achievement.id,
        facultyId,
        // status defaults to "pending"
      })),
    });

    return achievement;
  });

  // Tell every chosen faculty they have something to review.
  await notifyMany(
    facultyUserIds,
    NOTIFICATION_TYPES.ACHIEVEMENT_REVIEW_REQUESTED,
    `A student asked you to verify the achievement "${title.trim()}".`,
    FACULTY_REVIEW_LINK(created.id)
  );

  // Return the full record (with its fresh review rows).
  return repo.findByIdForStudent(created.id, student.id);
}

/** List the student's own achievements (paginated, each with its reviews). */
async function getMyAchievements(studentId, query) {
  const { page, limit, skip } = parsePagination(query);
  const [items, total] = await Promise.all([
    repo.findManyForStudent(studentId, skip, limit),
    repo.countForStudent(studentId),
  ]);
  return paginate(items, page, limit, total);
}

/** One of the student's own achievements. */
async function getMyAchievementById(achievementId, studentId) {
  const achievement = await repo.findByIdForStudent(Number(achievementId), studentId);
  if (!achievement) throw new AppError(404, "Achievement not found.");
  return achievement;
}

/** Edit text/url fields — allowed only while OVERALL status is still pending. */
async function updateAchievement(achievementId, studentId, body) {
  const id = Number(achievementId);

  const existing = await repo.findByIdForStudent(id, studentId);
  if (!existing) throw new AppError(404, "Achievement not found.");
  if (existing.status !== "pending") {
    throw new AppError(400, `Only pending achievements can be edited (this one is ${existing.status}).`);
  }

  const allowed = ["title", "category", "description", "certificateUrl", "proofUrl"];
  const data = {};
  for (const f of allowed) if (body[f] !== undefined) data[f] = body[f];
  if (Object.keys(data).length === 0) {
    throw new AppError(400, "No valid fields provided for update.");
  }

  if (data.title !== undefined && !isNonEmptyString(data.title)) {
    throw new AppError(400, "title cannot be empty.");
  }
  if (data.category !== undefined && !isNonEmptyString(data.category)) {
    throw new AppError(400, "category cannot be empty.");
  }
  if (data.certificateUrl !== undefined && !isValidUrl(data.certificateUrl)) {
    throw new AppError(400, "certificateUrl must be a valid http(s) URL.");
  }
  if (data.proofUrl !== undefined && !isValidUrl(data.proofUrl)) {
    throw new AppError(400, "proofUrl must be a valid http(s) URL.");
  }

  if (data.title)       data.title = data.title.trim();
  if (data.category)    data.category = data.category.trim();
  if (data.description) data.description = data.description.trim();

  return repo.updateTextById(id, data);
}

/** Delete an achievement — only while pending. Reviews cascade away. */
async function deleteAchievement(achievementId, studentId) {
  const id = Number(achievementId);
  const existing = await repo.findByIdForStudent(id, studentId);
  if (!existing) throw new AppError(404, "Achievement not found.");
  if (existing.status !== "pending") {
    throw new AppError(400, "Only pending achievements can be deleted.");
  }
  await repo.deleteById(id);
  return { message: "Achievement deleted." };
}

/**
 * Add more reviewer faculties to a pending achievement.
 * Skips any faculty already assigned (no duplicates). Notifies the new ones.
 */
async function addReviewers(achievementId, student, facultyIdsRaw) {
  const id = Number(achievementId);

  const existing = await repo.findByIdForStudent(id, student.id);
  if (!existing) throw new AppError(404, "Achievement not found.");
  if (existing.status !== "pending") {
    throw new AppError(400, "Reviewers can only be changed while the achievement is pending.");
  }

  const ids = normalizeFacultyIds(facultyIdsRaw);

  // Drop ids that are already reviewers (the @@unique would reject them anyway).
  const alreadyAssigned = new Set(existing.reviews.map((r) => r.facultyId));
  const toAdd = ids.filter((fid) => !alreadyAssigned.has(fid));
  if (toAdd.length === 0) {
    throw new AppError(400, "All of those faculties are already assigned.");
  }

  // Validate the new faculties belong to this school + get their user ids.
  const newUserIds = await resolveFacultyUserIds(toAdd, student.schoolId);

  await prisma.achievementReview.createMany({
    data: toAdd.map((facultyId) => ({ achievementId: id, facultyId })),
  });

  await notifyMany(
    newUserIds,
    NOTIFICATION_TYPES.ACHIEVEMENT_REVIEW_REQUESTED,
    `A student asked you to verify the achievement "${existing.title}".`,
    FACULTY_REVIEW_LINK(id)
  );

  return repo.findByIdForStudent(id, student.id);
}

/**
 * Remove a reviewer from a pending achievement.
 * Rules:
 *   - achievement must be pending
 *   - can only remove a faculty whose verdict is still pending
 *     (we never erase a verdict a faculty already gave)
 *   - cannot remove the last remaining reviewer (must keep at least one)
 */
async function removeReviewer(achievementId, studentId, facultyId) {
  const id  = Number(achievementId);
  const fid = Number(facultyId);

  const existing = await repo.findByIdForStudent(id, studentId);
  if (!existing) throw new AppError(404, "Achievement not found.");
  if (existing.status !== "pending") {
    throw new AppError(400, "Reviewers can only be changed while the achievement is pending.");
  }

  const review = await repo.findRawReview(id, fid);
  if (!review) throw new AppError(404, "That faculty is not a reviewer of this achievement.");
  if (review.status !== "pending") {
    throw new AppError(400, "Cannot remove a faculty who has already responded.");
  }

  const total = await repo.countReviews(id);
  if (total <= 1) {
    throw new AppError(400, "An achievement must keep at least one reviewer.");
  }

  await repo.deleteReview(id, fid);
  return repo.findByIdForStudent(id, studentId);
}

// =============================================================================
// FACULTY ACTIONS
// =============================================================================

/** A faculty's review queue (paginated). Optional ?status filter, default pending. */
async function getAssignedAchievements(facultyId, query) {
  const { page, limit, skip } = parsePagination(query);

  // default to the pending queue; allow "all" to see history too
  const VALID = ["pending", "approved", "rejected"];
  let status = "pending";
  if (query.status === "all") status = undefined;
  else if (VALID.includes(query.status)) status = query.status;

  const [items, total] = await Promise.all([
    repo.findAssignedForFaculty(facultyId, status, skip, limit),
    repo.countAssignedForFaculty(facultyId, status),
  ]);
  return paginate(items, page, limit, total);
}

/**
 * Review-detail screen for a faculty.
 *
 * Shows the achievement plus what EVERY assigned faculty decided — so faculty B
 * can see faculty A's verdict + remark, or be told they are the first to look.
 */
async function getReviewDetail(achievementId, facultyId) {
  const achievement = await repo.findByIdWithReviewsForFaculty(Number(achievementId), facultyId);
  if (!achievement) {
    throw new AppError(404, "Achievement not found or it was not sent to you.");
  }

  // Split the reviews into "mine" and "the others".
  const myReview = achievement.reviews.find((r) => r.facultyId === facultyId) || null;
  const otherReviews = achievement.reviews
    .filter((r) => r.facultyId !== facultyId)
    .map((r) => ({
      facultyId:   r.facultyId,
      facultyName: r.faculty?.user?.name ?? null,
      designation: r.faculty?.designation ?? null,
      status:      r.status,
      remark:      r.remark,
      reviewedAt:  r.reviewedAt,
    }));

  // Have any of the OTHER faculties responded yet?
  const respondedOthers = otherReviews.filter((r) => r.status !== "pending");
  const isFirstResponder = respondedOthers.length === 0;

  // Friendly headline for the UI.
  const message = isFirstResponder
    ? "You are the first to review this achievement."
    : `${respondedOthers.length} other faculty have already responded.`;

  // Strip the embedded reviews array from the achievement; we expose the
  // split + summarized version instead so the client doesn't get it twice.
  const { reviews, ...achievementCore } = achievement;

  return {
    achievement: achievementCore,
    myReview: myReview
      ? {
          status:     myReview.status,
          remark:     myReview.remark,
          reviewedAt: myReview.reviewedAt,
        }
      : null,
    otherReviews,
    isFirstResponder,
    message,
  };
}

/**
 * Shared internal: record THIS faculty's verdict, then recompute the rollup —
 * both inside one transaction so they can never disagree.
 *
 * @returns {{ overall: string, achievement: Object }}
 *   `achievement` includes the student's user id + title so we can notify.
 */
async function _recordDecision(achievementId, facultyId, newStatus, remark) {
  return prisma.$transaction(async (tx) => {
    // 1. Set this faculty's own verdict.
    await tx.achievementReview.update({
      where: { achievementId_facultyId: { achievementId, facultyId } },
      data: {
        status:     newStatus,
        remark:     isNonEmptyString(remark) ? remark.trim() : null,
        reviewedAt: new Date(),
      },
    });

    // 2. Re-read every verdict and compute the overall (rollup) status.
    const reviews = await tx.achievementReview.findMany({
      where: { achievementId },
      select: { status: true },
    });
    const overall = computeOverallStatus(reviews);

    // 3. Build the rollup update on the parent achievement.
    const data = { status: overall };
    if (overall === "approved") {
      // Unanimous approval just completed — the faculty acting now is the
      // LAST approver (the one whose approval made every review "approved").
      data.verifiedBy          = facultyId;
      data.verifiedAt          = new Date();
      data.verificationComment = isNonEmptyString(remark) ? remark.trim() : null;
      data.rejectionReason     = null;
    } else if (overall === "rejected") {
      data.verifiedBy      = null;
      data.verifiedAt      = new Date();
      data.rejectionReason = isNonEmptyString(remark) ? remark.trim() : null;
    }

    const achievement = await tx.achievement.update({
      where: { id: achievementId },
      data,
      select: {
        id: true,
        title: true,
        status: true,
        student: { select: { user: { select: { id: true } } } },
      },
    });

    return { overall, achievement };
  });
}

/**
 * Guard helper: make sure this faculty CAN act on this achievement right now.
 * Returns the review row. Throws the right error otherwise.
 */
async function _assertCanReview(achievementId, facultyId) {
  const review = await repo.findReviewRow(achievementId, facultyId);
  if (!review) {
    throw new AppError(404, "This achievement was not sent to you for review.");
  }
  if (review.achievement.status !== "pending") {
    throw new AppError(409, `This achievement is already ${review.achievement.status}.`);
  }
  if (review.status !== "pending") {
    throw new AppError(409, "You have already reviewed this achievement.");
  }
  return review;
}

/** Faculty approves their review. Remark optional. Approved only once ALL approve. */
async function verifyAchievement(achievementId, facultyId, remark) {
  const id = Number(achievementId);
  await _assertCanReview(id, facultyId);

  const { overall, achievement } = await _recordDecision(id, facultyId, "approved", remark);

  // Only notify the student once EVERY assigned reviewer has approved and the
  // achievement is fully verified. While others are still pending, stay quiet.
  if (overall === "approved") {
    await notify(
      achievement.student.user.id,
      NOTIFICATION_TYPES.ACHIEVEMENT_APPROVED,
      `Your achievement "${achievement.title}" was approved.`,
      STUDENT_ACHIEVEMENT_LINK(id)
    );
  }

  const message =
    overall === "approved"
      ? "Final approval recorded — the achievement is now approved."
      : "Your approval was recorded. Waiting on the other reviewers.";
  return { overallStatus: overall, message };
}

/** Faculty rejects their review. Remark REQUIRED. A single rejection rejects overall. */
async function rejectAchievement(achievementId, facultyId, remark) {
  const id = Number(achievementId);

  if (!isNonEmptyString(remark)) {
    throw new AppError(400, "A remark is required when rejecting.");
  }

  await _assertCanReview(id, facultyId);

  const { overall, achievement } = await _recordDecision(id, facultyId, "rejected", remark);

  // A single rejection settles the achievement as rejected (unanimous
  // approval is no longer possible), so notify the student right away.
  if (overall === "rejected") {
    await notify(
      achievement.student.user.id,
      NOTIFICATION_TYPES.ACHIEVEMENT_REJECTED,
      `Your achievement "${achievement.title}" was rejected: ${remark.trim()}`,
      STUDENT_ACHIEVEMENT_LINK(id)
    );
  }

  return {
    overallStatus: overall,
    message:
      overall === "rejected"
        ? "Your rejection was recorded. The achievement is now rejected."
        : "Your rejection was recorded. Other faculties are still reviewing.",
  };
}

// =============================================================================
// HOD DASHBOARD (read-only)
// =============================================================================

/** All achievements in the HOD's department (read-only), optional ?status. */
async function getDepartmentAchievements(schoolId, departmentId, query) {
  const { page, limit, skip } = parsePagination(query);
  const VALID = ["pending", "approved", "rejected"];
  const status = VALID.includes(query.status) ? query.status : undefined;

  const [items, total] = await Promise.all([
    repo.findManyForDepartment(schoolId, departmentId, status, skip, limit),
    repo.countForDepartment(schoolId, departmentId, status),
  ]);
  return paginate(items, page, limit, total);
}

module.exports = {
  // student
  createAchievement,
  getMyAchievements,
  getMyAchievementById,
  updateAchievement,
  deleteAchievement,
  addReviewers,
  removeReviewer,
  // faculty
  getAssignedAchievements,
  getReviewDetail,
  verifyAchievement,
  rejectAchievement,
  // hod
  getDepartmentAchievements,
  // exported for clarity/testing
  computeOverallStatus,
};