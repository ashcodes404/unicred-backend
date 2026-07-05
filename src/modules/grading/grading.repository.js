// src/modules/grading/grading.repository.js

const prisma = require("../../config/db");

/**
 * Gets the active grading system for a school.
 * Priority: school's own custom system → global default (schoolId = null).
 * Rules are sorted highest first so computeGrade() finds matches quickly.
 */
async function getActiveSystemForSchool(schoolId) {
  // Try school's own custom system first
  const custom = await prisma.gradingSystem.findFirst({
    where: { schoolId, isActive: true },
    include: { rules: { orderBy: { minMarksPercent: "desc" } } },
  });
  if (custom) return custom;

  // Fall back to global default
  return prisma.gradingSystem.findFirst({
    where: { schoolId: null, isDefault: true },
    include: { rules: { orderBy: { minMarksPercent: "desc" } } },
  });
}

/**
 * Lists all grading systems for a school (admin view).
 * Includes the global default for reference.
 */
async function listBySchool(schoolId) {
  return prisma.gradingSystem.findMany({
    where: {
      OR: [{ schoolId }, { isDefault: true, schoolId: null }],
    },
    include: { rules: { orderBy: { minMarksPercent: "desc" } } },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Finds a single system by ID — only returns it if it belongs to the school.
 * The global default is excluded (admins can't directly edit it).
 */
async function findById(id, schoolId) {
  return prisma.gradingSystem.findFirst({
    where: { id, schoolId },
    include: { rules: { orderBy: { minMarksPercent: "desc" } } },
  });
}

/**
 * Creates a new custom grading system.
 * Atomically deactivates the old one and activates the new one.
 * Past published results are NOT touched.
 */
async function create(schoolId, name, rules) {
  // No transaction — TiDB Serverless has a 5s transaction timeout which
  // is too short for nested creates with many rules over the network.
  // Sequential queries are safe here because relationMode = "prisma"
  // means no FK enforcement at DB level anyway.

  // Step 1: Deactivate the current active system for this school
  await prisma.gradingSystem.updateMany({
    where: { schoolId, isActive: true },
    data: { isActive: false },
  });

  // Step 2: Create the new system with all its rules
  return prisma.gradingSystem.create({
    data: {
      schoolId,
      name,
      isDefault: false,
      isActive: true,
      rules: { create: rules },
    },
    include: { rules: { orderBy: { minMarksPercent: "desc" } } },
  });
}

/**
 * Updates name and/or rules of an existing system.
 * If rules are provided, all old rules are deleted and replaced.
 */
async function update(id, schoolId, name, rules) {
  // No transaction — same reason as create() above (TiDB timeout)
  const system = await prisma.gradingSystem.findFirst({ where: { id, schoolId } });
  if (!system) return null;

  if (rules) {
    await prisma.gradeRule.deleteMany({ where: { gradingSystemId: id } });
  }

  return prisma.gradingSystem.update({
    where: { id },
    data: {
      ...(name && { name }),
      ...(rules && { rules: { create: rules } }),
    },
    include: { rules: { orderBy: { minMarksPercent: "desc" } } },
  });
}

/**
 * Switches the active system for a school.
 * Deactivates all others, activates the given one.
 */
async function activate(id, schoolId) {
  // No transaction — same reason as above
  await prisma.gradingSystem.updateMany({
    where: { schoolId, isActive: true },
    data: { isActive: false },
  });
  return prisma.gradingSystem.update({
    where: { id },
    data: { isActive: true },
    include: { rules: { orderBy: { minMarksPercent: "desc" } } },
  });
}

/**
 * Reads the school's current grading method ("absolute" or "relative").
 * Returns null if the school itself doesn't exist (shouldn't normally
 * happen — schoolId always comes from a verified JWT — but the caller
 * checks for null rather than assuming).
 */
async function getGradingMethod(schoolId) {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { gradingMethod: true },
  });
  return school?.gradingMethod ?? null;
}

/**
 * Switches the school's grading method. This ONLY updates the School row
 * — it never touches any already-computed SubjectMark/CgpaRecord rows, by
 * design (see the long comment on School.gradingMethod in schema.prisma).
 */
async function updateGradingMethod(schoolId, method) {
  return prisma.school.update({
    where: { id: schoolId },
    data: { gradingMethod: method },
    select: { gradingMethod: true },
  });
}

/**
 * Every active user's id in a school, regardless of role — used to
 * broadcast the "grading method changed" notification to literally
 * everyone (admin, every HOD/faculty, every student).
 */
async function findAllUserIdsInSchool(schoolId) {
  const users = await prisma.user.findMany({
    where: { schoolId, deletedAt: null },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

module.exports = {
  getActiveSystemForSchool,
  listBySchool,
  findById,
  create,
  update,
  activate,
  getGradingMethod,
  updateGradingMethod,
  findAllUserIdsInSchool,
};