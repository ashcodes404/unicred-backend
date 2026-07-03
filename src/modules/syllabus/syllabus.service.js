// =============================================================================
// SYLLABUS SERVICE  (src/modules/syllabus/syllabus.service.js)
// =============================================================================
//
// Business rules for syllabus files:
//   - HOD manages (create/update/delete) syllabus for their OWN department's
//     subjects only.
//   - Faculty and students VIEW the syllabus of their OWN department only.
// Department is always derived server-side (HOD from facultyContext; faculty/
// students resolved from their own record) — never taken from the request.
// =============================================================================

const repo = require("./syllabus.repository");
const prisma = require("../../config/db");
const AppError = require("../../utils/AppError");
const { isValidUrl } = require("../../utils/validators");
const { cached, invalidate } = require("../../utils/cache");

/**
 * Resolve a non-admin user's department from their role-specific record.
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

/** Ensure a subject exists and belongs to the given school + department. */
async function assertSubjectInDepartment(subjectId, schoolId, departmentId) {
  const subject = await prisma.subject.findFirst({
    where: { id: Number(subjectId), schoolId, departmentId },
    select: { id: true },
  });
  if (!subject) {
    throw new AppError(404, "Subject not found in your department.");
  }
}

/**
 * List the syllabus files for the CALLER's own department (grouped-ready,
 * each file tagged with its subject). Works for HOD, faculty, and students.
 */
async function listForUser(user) {
  const departmentId = await resolveUserDepartmentId(user);
  if (!departmentId) {
    throw new AppError(403, "No department is associated with your account.");
  }
  return cached(
    `syl:${user.schoolId}:${departmentId}`,
    null,
    () => repo.findByDepartment(user.schoolId, departmentId),
    `syl:${user.schoolId}`
  );
}

/** HOD: add a syllabus file to one of their department's subjects. */
async function createSyllabusFile(schoolId, departmentId, body, uploadedById) {
  const { subjectId, fileUrl, title } = body;
  if (!subjectId) throw new AppError(400, "subjectId is required.");
  if (!fileUrl || !isValidUrl(fileUrl)) {
    throw new AppError(400, "A valid uploaded file URL is required.");
  }
  await assertSubjectInDepartment(subjectId, schoolId, departmentId);

  const file = await repo.create({
    schoolId,
    departmentId,
    subjectId: Number(subjectId),
    fileUrl,
    title: title?.trim() || null,
    uploadedById,
  });

  await invalidate(`syl:${schoolId}`);

  return file;
}

/** Load a file and confirm it belongs to the HOD's department. */
async function getOwnedFileOr404(id, schoolId, departmentId) {
  const file = await repo.findById(Number(id), schoolId);
  if (!file || file.departmentId !== departmentId) {
    throw new AppError(404, "Syllabus file not found in your department.");
  }
  return file;
}

/** HOD: update/replace a syllabus file (new URL and/or title). */
async function updateSyllabusFile(id, schoolId, departmentId, body) {
  await getOwnedFileOr404(id, schoolId, departmentId);

  const data = {};
  if (body.fileUrl !== undefined) {
    if (!isValidUrl(body.fileUrl)) throw new AppError(400, "fileUrl must be a valid http(s) URL.");
    data.fileUrl = body.fileUrl;
  }
  if (body.title !== undefined) data.title = body.title?.trim() || null;

  if (Object.keys(data).length === 0) {
    throw new AppError(400, "Nothing to update.");
  }
  const file = await repo.updateById(Number(id), data);
  await invalidate(`syl:${schoolId}`);
  return file;
}

/** HOD: delete a syllabus file. */
async function deleteSyllabusFile(id, schoolId, departmentId) {
  await getOwnedFileOr404(id, schoolId, departmentId);
  await repo.deleteById(Number(id));
  await invalidate(`syl:${schoolId}`);
  return { message: "Syllabus file deleted." };
}

module.exports = {
  listForUser,
  createSyllabusFile,
  updateSyllabusFile,
  deleteSyllabusFile,
};
