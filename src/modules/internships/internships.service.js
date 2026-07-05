// =============================================================================
// INTERNSHIPS SERVICE
// =============================================================================
//
// Business logic + validation + authorization for internships.
//
// An internship can OPTIONALLY link to one of the student's achievements
// (e.g. an offer letter the student uploaded as an achievement for faculty
// verification). The internship then "inherits" that achievement's status as
// its verification badge — we never store a separate status on the internship.
// =============================================================================

const repo            = require("./internships.repository");
const achievementRepo = require("../achievements/achievements.repository"); // reuse ownership check
const AppError        = require("../../utils/AppError");
const { isNonEmptyString, isValidUrl } = require("../../utils/validators");

// ── Pagination helpers (same shape as the achievements/notifications modules) ──

function parsePagination(query = {}) {
  let page  = Number(query.page);
  let limit = Number(query.limit);

  if (Number.isNaN(page)  || page  < 1) page  = 1;
  if (Number.isNaN(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100;

  return { page, limit, skip: (page - 1) * limit };
}

function paginate(items, page, limit, total) {
  return {
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/**
 * Parse + validate an optional date string (e.g. "2026-05-01").
 *
 * - returns null if the value was not provided
 * - throws AppError(400) if it was provided but is not a real date
 *
 * `new Date(str)` builds a Date. If the string is junk, the Date's time is
 * NaN — we detect that with Number.isNaN(date.getTime()).
 *
 * @returns {Date|null}
 */
function parseOptionalDate(value, fieldName) {
  if (value === undefined || value === null || value === "") return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(400, `${fieldName} is not a valid date.`);
  }
  return date;
}

/**
 * Verify a linked achievement is valid for THIS student and free to link.
 *
 * Rules:
 *   1. The achievement must exist and belong to this student.
 *   2. The achievement must not already be linked to another internship
 *      (Internship.achievementId is unique — one internship per achievement).
 *
 * @param {number} achievementId
 * @param {number} studentId
 * @param {number|null} ignoreInternshipId - when re-checking during an update,
 *        the internship we're editing is allowed to keep its own link.
 */
async function assertLinkableAchievement(achievementId, studentId, ignoreInternshipId = null) {
  // 1. Ownership: belongs to this student?
  const achievement = await achievementRepo.findByIdForStudent(achievementId, studentId);
  if (!achievement) {
    throw new AppError(404, "Linked achievement not found for this student.");
  }

  // 2. Not already taken by a different internship?
  const existingLink = await repo.findByAchievementId(achievementId);
  if (existingLink && existingLink.id !== ignoreInternshipId) {
    throw new AppError(409, "This achievement is already linked to another internship.");
  }
}

// =============================================================================
// STUDENT ACTIONS
// =============================================================================

/**
 * Create an internship (student).
 *
 * Validations:
 *   1. companyName and role are required
 *   2. offerLetterUrl / certificateUrl, if sent, must be valid http(s) URLs
 *   3. startDate / endDate, if sent, must be valid dates; endDate >= startDate
 *   4. stipend, if sent, must be a number >= 0
 *   5. achievementId, if sent, must belong to the student and be unlinked
 */
async function createInternship(student, body) {
  const {
    companyName, role, startDate, endDate,
    stipend, offerLetterUrl, certificateUrl, achievementId,
  } = body;

  // ── Required fields ─────────────────────────────────────────────────────
  if (!isNonEmptyString(companyName) || !isNonEmptyString(role)) {
    throw new AppError(400, "companyName and role are required.");
  }

  // ── URL checks ──────────────────────────────────────────────────────────
  if (offerLetterUrl !== undefined && !isValidUrl(offerLetterUrl)) {
    throw new AppError(400, "offerLetterUrl must be a valid http(s) URL.");
  }
  if (certificateUrl !== undefined && !isValidUrl(certificateUrl)) {
    throw new AppError(400, "certificateUrl must be a valid http(s) URL.");
  }

  // ── Dates ───────────────────────────────────────────────────────────────
  const start = parseOptionalDate(startDate, "startDate");
  const end   = parseOptionalDate(endDate, "endDate");
  if (start && end && end < start) {
    throw new AppError(400, "endDate cannot be before startDate.");
  }

  // ── Stipend ─────────────────────────────────────────────────────────────
  let stipendValue = null;
  if (stipend !== undefined && stipend !== null && stipend !== "") {
    stipendValue = Number(stipend);
    if (Number.isNaN(stipendValue) || stipendValue < 0) {
      throw new AppError(400, "stipend must be a number of 0 or more.");
    }
  }

  // ── Optional achievement link ───────────────────────────────────────────
  let linkedAchievementId = null;
  if (achievementId !== undefined && achievementId !== null) {
    linkedAchievementId = Number(achievementId);
    await assertLinkableAchievement(linkedAchievementId, student.id);
  }

  return repo.create({
    studentId:      student.id,
    companyName:    companyName.trim(),
    role:           role.trim(),
    startDate:      start,
    endDate:        end,
    stipend:        stipendValue,
    offerLetterUrl: offerLetterUrl ?? null,
    certificateUrl: certificateUrl ?? null,
    achievementId:  linkedAchievementId,
  });
}

/** List the student's own internships (paginated). */
async function getMyInternships(studentId, query) {
  const { page, limit, skip } = parsePagination(query);

  const [items, total] = await Promise.all([
    repo.findManyForStudent(studentId, skip, limit),
    repo.countForStudent(studentId),
  ]);

  return paginate(items, page, limit, total);
}

/**
 * Get one of the student's own internships.
 * The repository already includes `achievement.status` so the frontend can
 * render the verification badge.
 */
async function getMyInternshipById(internshipId, studentId) {
  const internship = await repo.findByIdForStudent(Number(internshipId), studentId);
  if (!internship) {
    throw new AppError(404, "Internship not found.");
  }
  return internship;
}

/**
 * Edit an internship (student). Internships can be edited any time (unlike
 * achievements) because they carry no review lifecycle of their own.
 */
async function updateInternship(internshipId, studentId, body) {
  const id = Number(internshipId);

  const existing = await repo.findByIdForStudent(id, studentId);
  if (!existing) {
    throw new AppError(404, "Internship not found.");
  }

  // Once the linked achievement is approved, the internship is verified and
  // locked — editing it would undermine that verification.
  if (existing.achievement && existing.achievement.status === "approved") {
    throw new AppError(
      409,
      "This internship is verified through an approved achievement and can no longer be edited.",
    );
  }

  const allowed = [
    "companyName", "role", "startDate", "endDate",
    "stipend", "offerLetterUrl", "certificateUrl",
  ];
  const data = {};
  for (const field of allowed) {
    if (body[field] !== undefined) data[field] = body[field];
  }

  if (Object.keys(data).length === 0) {
    throw new AppError(400, "No valid fields provided for update.");
  }

  // Re-validate each field that is being changed.
  if (data.companyName !== undefined && !isNonEmptyString(data.companyName)) {
    throw new AppError(400, "companyName cannot be empty.");
  }
  if (data.role !== undefined && !isNonEmptyString(data.role)) {
    throw new AppError(400, "role cannot be empty.");
  }
  if (data.offerLetterUrl !== undefined && !isValidUrl(data.offerLetterUrl)) {
    throw new AppError(400, "offerLetterUrl must be a valid http(s) URL.");
  }
  if (data.certificateUrl !== undefined && !isValidUrl(data.certificateUrl)) {
    throw new AppError(400, "certificateUrl must be a valid http(s) URL.");
  }

  // Dates: parse the ones being changed, then check ordering against
  // whatever the final start/end will be (new value if changing, else existing).
  if (data.startDate !== undefined) data.startDate = parseOptionalDate(data.startDate, "startDate");
  if (data.endDate   !== undefined) data.endDate   = parseOptionalDate(data.endDate, "endDate");

  const finalStart = data.startDate !== undefined ? data.startDate : existing.startDate;
  const finalEnd   = data.endDate   !== undefined ? data.endDate   : existing.endDate;
  if (finalStart && finalEnd && finalEnd < finalStart) {
    throw new AppError(400, "endDate cannot be before startDate.");
  }

  // Stipend
  if (data.stipend !== undefined) {
    if (data.stipend === null || data.stipend === "") {
      data.stipend = null;
    } else {
      const n = Number(data.stipend);
      if (Number.isNaN(n) || n < 0) {
        throw new AppError(400, "stipend must be a number of 0 or more.");
      }
      data.stipend = n;
    }
  }

  // Trim text fields.
  if (data.companyName) data.companyName = data.companyName.trim();
  if (data.role)        data.role = data.role.trim();

  return repo.updateById(id, data);
}

/** Delete an internship (student). */
async function deleteInternship(internshipId, studentId) {
  const id = Number(internshipId);

  const existing = await repo.findByIdForStudent(id, studentId);
  if (!existing) {
    throw new AppError(404, "Internship not found.");
  }

  // A verified (approved-achievement) internship is locked — can't be deleted.
  if (existing.achievement && existing.achievement.status === "approved") {
    throw new AppError(
      409,
      "This internship is verified through an approved achievement and can no longer be deleted.",
    );
  }

  await repo.deleteById(id);
  return { message: "Internship deleted." };
}

/**
 * Link an existing achievement to an internship AFTER creation.
 * (Roadmap: PATCH /api/internships/:id/link-achievement)
 *
 * The achievement must belong to the same student and not already be linked.
 */
async function linkAchievement(internshipId, studentId, achievementId) {
  const id = Number(internshipId);

  if (achievementId === undefined || achievementId === null) {
    throw new AppError(400, "achievementId is required.");
  }
  const achId = Number(achievementId);

  // Internship must exist and belong to this student.
  const internship = await repo.findByIdForStudent(id, studentId);
  if (!internship) {
    throw new AppError(404, "Internship not found.");
  }

  // Achievement must be this student's and free to link.
  // We pass `id` as ignoreInternshipId so re-linking the same pair is harmless.
  await assertLinkableAchievement(achId, studentId, id);

  return repo.updateById(id, { achievementId: achId });
}

// =============================================================================
// HOD DASHBOARD (read-only)
// =============================================================================

/** List every internship in the HOD's department (read-only stats view). */
async function getDepartmentInternships(schoolId, departmentId, query) {
  const { page, limit, skip } = parsePagination(query);

  const [items, total] = await Promise.all([
    repo.findManyForDepartment(schoolId, departmentId, skip, limit),
    repo.countForDepartment(schoolId, departmentId),
  ]);

  return paginate(items, page, limit, total);
}

module.exports = {
  createInternship,
  getMyInternships,
  getMyInternshipById,
  updateInternship,
  deleteInternship,
  linkAchievement,
  getDepartmentInternships,
};