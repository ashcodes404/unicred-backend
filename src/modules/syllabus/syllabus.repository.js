// =============================================================================
// SYLLABUS REPOSITORY  (src/modules/syllabus/syllabus.repository.js)
// =============================================================================
//
// Data access for uploaded syllabus files (PDF/image). A subject can have many
// files. All rows carry schoolId + departmentId so reads stay tenant- and
// department-scoped. Subject name/code is attached in a second query (no DB
// foreign keys under relationMode = "prisma", so we merge in code).
// =============================================================================

const prisma = require("../../config/db");

const FILE_SELECT = {
  id: true,
  subjectId: true,
  fileUrl: true,
  title: true,
  createdAt: true,
  updatedAt: true,
};

/** Insert a new syllabus file row. */
async function create(data) {
  return prisma.syllabusFile.create({ data, select: FILE_SELECT });
}

/**
 * All syllabus files for one department, each tagged with its subject's
 * name + courseCode so the UI can group by course.
 */
async function findByDepartment(schoolId, departmentId) {
  const files = await prisma.syllabusFile.findMany({
    where: { schoolId, departmentId },
    orderBy: [{ subjectId: "asc" }, { createdAt: "asc" }],
    select: FILE_SELECT,
  });
  if (files.length === 0) return [];

  const subjectIds = [...new Set(files.map((f) => f.subjectId))];
  const subjects = await prisma.subject.findMany({
    where: { id: { in: subjectIds }, schoolId },
    select: { id: true, name: true, courseCode: true },
  });
  const byId = Object.fromEntries(subjects.map((s) => [s.id, s]));

  return files.map((f) => ({ ...f, subject: byId[f.subjectId] ?? null }));
}

/** One file by id, scoped to school (for ownership/department checks). */
async function findById(id, schoolId) {
  return prisma.syllabusFile.findFirst({
    where: { id, schoolId },
    select: { ...FILE_SELECT, departmentId: true, schoolId: true },
  });
}

async function updateById(id, data) {
  return prisma.syllabusFile.update({ where: { id }, data, select: FILE_SELECT });
}

async function deleteById(id) {
  return prisma.syllabusFile.delete({ where: { id } });
}

module.exports = {
  create,
  findByDepartment,
  findById,
  updateById,
  deleteById,
};
