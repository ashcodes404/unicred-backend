// =============================================================================
// INTERNSHIPS REPOSITORY
// =============================================================================
//
// Pure Prisma data-access. No business rules, no HTTP.
//
// MULTI-TENANCY NOTE (same as achievements):
//   The `internships` table has NO schoolId column. We enforce tenant
//   isolation through the student relation:
//     - student-scoped reads/writes -> filter by `studentId`
//     - HOD dashboard               -> filter by `student: { schoolId, departmentId }`
//
// VERIFICATION NOTE:
//   An internship has no status of its own. Its "verified" badge is DERIVED
//   from the linked achievement's status. So whenever we return an internship
//   we also include `achievement: { status }` when one is linked.
// =============================================================================

const prisma = require("../../config/db");

// Standard output shape. We always include the linked achievement's status
// (null when not linked) so the frontend can show a verification badge.
const INTERNSHIP_SELECT = {
  id: true,
  studentId: true,
  achievementId: true,
  companyName: true,
  role: true,
  startDate: true,
  endDate: true,
  stipend: true,
  offerLetterUrl: true,
  certificateUrl: true,
  createdAt: true,
  updatedAt: true,
  achievement: {
    select: { id: true, title: true, status: true },
  },
};

// =============================================================================
// CREATE
// =============================================================================

/** Insert a new internship row. */
async function create(data) {
  return prisma.internship.create({
    data,
    select: INTERNSHIP_SELECT,
  });
}

// =============================================================================
// STUDENT-SCOPED READS  (owner only)
// =============================================================================

/** Find one internship that belongs to a specific student. */
async function findByIdForStudent(internshipId, studentId) {
  return prisma.internship.findFirst({
    where: { id: internshipId, studentId },
    select: INTERNSHIP_SELECT,
  });
}

/** Paginated list of a student's own internships, newest first. */
async function findManyForStudent(studentId, skip, take) {
  return prisma.internship.findMany({
    where: { studentId },
    orderBy: { createdAt: "desc" },
    skip,
    take,
    select: INTERNSHIP_SELECT,
  });
}

/** Count a student's internships (for pagination metadata). */
async function countForStudent(studentId) {
  return prisma.internship.count({ where: { studentId } });
}

// =============================================================================
// LINK LOOKUP
// =============================================================================

/**
 * Find the internship (if any) already linked to a given achievement.
 * Used to enforce the "one internship per achievement" rule before linking.
 * (Internship.achievementId is @unique in the schema.)
 */
async function findByAchievementId(achievementId) {
  return prisma.internship.findUnique({
    where: { achievementId },
    select: { id: true, studentId: true },
  });
}

// =============================================================================
// HOD DASHBOARD READ  (department-scoped, read-only)
// =============================================================================

/** Paginated list of every internship in a department. */
async function findManyForDepartment(schoolId, departmentId, skip, take) {
  return prisma.internship.findMany({
    where: { student: { schoolId, departmentId } },
    orderBy: { createdAt: "desc" },
    skip,
    take,
    select: {
      ...INTERNSHIP_SELECT,
      student: {
        select: {
          id: true,
          rollNo: true,
          user: { select: { name: true } },
        },
      },
    },
  });
}

/** Count department internships (for pagination metadata). */
async function countForDepartment(schoolId, departmentId) {
  return prisma.internship.count({
    where: { student: { schoolId, departmentId } },
  });
}

// =============================================================================
// WRITES
// =============================================================================

/** Update an internship by id (service has already proven ownership). */
async function updateById(internshipId, data) {
  return prisma.internship.update({
    where: { id: internshipId },
    data,
    select: INTERNSHIP_SELECT,
  });
}

/** Delete an internship by id (service has already proven ownership). */
async function deleteById(internshipId) {
  return prisma.internship.delete({ where: { id: internshipId } });
}

module.exports = {
  create,
  findByIdForStudent,
  findManyForStudent,
  countForStudent,
  findByAchievementId,
  findManyForDepartment,
  countForDepartment,
  updateById,
  deleteById,
};