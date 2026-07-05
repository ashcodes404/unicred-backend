// =============================================================================
// ACHIEVEMENTS REPOSITORY
// =============================================================================
//
// Pure database-access layer (Prisma only). No business rules, no HTTP.
//
// MULTI-TENANCY NOTE:
//   The `achievements` table has NO schoolId column. Tenant isolation is done
//   through the student relation:
//     - student-scoped reads/writes -> filter by `studentId`
//     - faculty-scoped reads         -> filter by the faculty's review rows
//     - HOD dashboard                -> filter by `student: { schoolId, departmentId }`
//
// MULTI-FACULTY (Option B):
//   A student sends one achievement to several faculties. Each faculty gets one
//   row in `achievement_reviews` (the AchievementReview model). That row holds
//   THAT faculty's own verdict (status + remark). The achievement's own `status`
//   is a rollup computed in the SERVICE (any approve -> approved, all reject ->
//   rejected, else pending).
//
//   Transactional writes (create-with-reviews, record-decision) live in the
//   SERVICE so the rollup is computed in the same transaction — this mirrors
//   how results.service.js already works.
// =============================================================================

const prisma = require("../../config/db");

// How we show each per-faculty review (includes the reviewing faculty's name).
const REVIEW_SELECT = {
  id: true,
  facultyId: true,
  status: true,
  remark: true,
  reviewedAt: true,
  faculty: {
    select: {
      id: true,
      designation: true,
      user: { select: { id: true, name: true } },
    },
  },
};

// Standard achievement output shape, including the list of per-faculty reviews.
const ACHIEVEMENT_SELECT = {
  id: true,
  studentId: true,
  sessionId: true,
  title: true,
  category: true,
  description: true,
  certificateUrl: true,
  proofUrl: true,
  status: true, // overall rollup status
  verifiedBy: true,
  verificationComment: true,
  rejectionReason: true,
  verifiedAt: true,
  createdAt: true,
  updatedAt: true,
  reviews: {
    select: REVIEW_SELECT,
    orderBy: { createdAt: "asc" },
  },
};

// =============================================================================
// STUDENT-SCOPED READS  (owner only)
// =============================================================================

/** One achievement owned by a specific student (with all its reviews). */
async function findByIdForStudent(achievementId, studentId) {
  return prisma.achievement.findFirst({
    where: { id: achievementId, studentId },
    select: ACHIEVEMENT_SELECT,
  });
}

/** Paginated list of a student's own achievements, newest first. */
async function findManyForStudent(studentId, skip, take) {
  return prisma.achievement.findMany({
    where: { studentId },
    orderBy: { createdAt: "desc" },
    skip,
    take,
    select: ACHIEVEMENT_SELECT,
  });
}

/** Count a student's achievements (pagination metadata). */
async function countForStudent(studentId) {
  return prisma.achievement.count({ where: { studentId } });
}

// =============================================================================
// FACULTY-SCOPED READS  (only achievements sent to THIS faculty)
// =============================================================================

/**
 * The single review row for (achievement, faculty).
 * Used to authorize a faculty action and to read the current verdict.
 * Returns null if this achievement was never sent to this faculty.
 *
 * `achievementId_facultyId` is the compound-unique key Prisma auto-creates
 * from `@@unique([achievementId, facultyId])` in the schema.
 */
async function findReviewRow(achievementId, facultyId) {
  return prisma.achievementReview.findUnique({
    where: { achievementId_facultyId: { achievementId, facultyId } },
    select: {
      id: true,
      status: true,
      achievement: { select: { id: true, status: true, title: true } },
    },
  });
}

/**
 * A faculty's review queue: the achievements sent to them, with each one's
 * full review list embedded. Optional status filter on THEIR own verdict.
 *
 * We query the review rows (not achievements) because "assigned to me" is a
 * property of the review row, then pull the parent achievement for each.
 */
async function findAssignedForFaculty(facultyId, status, skip, take) {
  return prisma.achievementReview.findMany({
    where: {
      facultyId,
      // Filter by the achievement's OVERALL status (not this faculty's own
      // verdict) so the queue tabs reflect where the achievement actually
      // stands — e.g. one approved by every reviewer shows under "Approved".
      ...(status ? { achievement: { status } } : {}),
    },
    orderBy: { createdAt: "asc" }, // oldest request first = fair queue
    skip,
    take,
    select: {
      id: true,
      status: true, // this faculty's own verdict
      remark: true,
      reviewedAt: true,
      achievement: {
        select: {
          id: true,
          title: true,
          category: true,
          status: true, // overall rollup
          createdAt: true,
          student: {
            select: { id: true, rollNo: true, user: { select: { name: true } } },
          },
        },
      },
    },
  });
}

/** Count a faculty's assigned reviews (optionally by the achievement's overall status). */
async function countAssignedForFaculty(facultyId, status) {
  return prisma.achievementReview.count({
    where: { facultyId, ...(status ? { achievement: { status } } : {}) },
  });
}

/**
 * Full achievement + ALL reviews, but only if this faculty is one of the
 * assigned reviewers (`reviews: { some: { facultyId } }`).
 * This powers the "see what other faculty decided" review screen.
 */
async function findByIdWithReviewsForFaculty(achievementId, facultyId) {
  return prisma.achievement.findFirst({
    where: {
      id: achievementId,
      reviews: { some: { facultyId } }, // must have been sent to me
    },
    select: {
      ...ACHIEVEMENT_SELECT,
      student: {
        select: { id: true, rollNo: true, user: { select: { name: true } } },
      },
    },
  });
}

// =============================================================================
// HOD DASHBOARD READ  (department-scoped, read-only)
// =============================================================================

/** Paginated achievements across a department (HOD view), optional status. */
async function findManyForDepartment(schoolId, departmentId, status, skip, take) {
  return prisma.achievement.findMany({
    where: {
      student: { schoolId, departmentId },
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: "desc" },
    skip,
    take,
    select: {
      ...ACHIEVEMENT_SELECT,
      student: {
        select: { id: true, rollNo: true, user: { select: { name: true } } },
      },
    },
  });
}

/** Count department achievements (optionally by status). */
async function countForDepartment(schoolId, departmentId, status) {
  return prisma.achievement.count({
    where: {
      student: { schoolId, departmentId },
      ...(status ? { status } : {}),
    },
  });
}

// =============================================================================
// SIMPLE (NON-TRANSACTIONAL) WRITES
// =============================================================================

/**
 * Update only the achievement's own text/url fields by id.
 * Ownership + "still pending" are checked in the service before this runs.
 */
async function updateTextById(achievementId, data) {
  return prisma.achievement.update({
    where: { id: achievementId },
    data,
    select: ACHIEVEMENT_SELECT,
  });
}

/** Delete an achievement by id. Its reviews cascade away (onDelete: Cascade). */
async function deleteById(achievementId) {
  return prisma.achievement.delete({ where: { id: achievementId } });
}

/** Find a single review row by (achievement, faculty) — used before removing. */
async function findRawReview(achievementId, facultyId) {
  return prisma.achievementReview.findUnique({
    where: { achievementId_facultyId: { achievementId, facultyId } },
    select: { id: true, status: true },
  });
}

/** Delete one review row (remove a pending reviewer). */
async function deleteReview(achievementId, facultyId) {
  return prisma.achievementReview.delete({
    where: { achievementId_facultyId: { achievementId, facultyId } },
  });
}

/** Count how many reviews an achievement currently has (to block "zero reviewers"). */
async function countReviews(achievementId) {
  return prisma.achievementReview.count({ where: { achievementId } });
}

module.exports = {
  // reads
  findByIdForStudent,
  findManyForStudent,
  countForStudent,
  findReviewRow,
  findAssignedForFaculty,
  countAssignedForFaculty,
  findByIdWithReviewsForFaculty,
  findManyForDepartment,
  countForDepartment,
  // simple writes
  updateTextById,
  deleteById,
  findRawReview,
  deleteReview,
  countReviews,
};