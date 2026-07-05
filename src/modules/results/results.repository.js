// src/modules/results/results.repository.js

const prisma = require("../../config/db");

// ─── Publications ─────────────────────────────────────────────────────────────

/**
 * Creates a result publication and auto-generates one FacultyResultSubmission
 * row per FacultyAssignment for that session+batch+semester.
 * HOD can immediately see "2/5 subjects submitted" after creation.
 */
async function createPublication(schoolId, sessionId, departmentId, batchYear, semesterNumber) {
  return prisma.$transaction(async (tx) => {
    const publication = await tx.resultPublication.create({
      data: { schoolId, sessionId, departmentId, batchYear, semesterNumber, status: "draft" },
    });

    // Find faculty assigned to this session+batch+semester scoped to this department only.
    // Without departmentId, other departments' assignments would generate orphan
    // FacultyResultSubmission rows that can never be submitted, blocking publication.
    const assignments = await tx.facultyAssignment.findMany({
      where: { schoolId, sessionId, departmentId, batchYear, semesterNumber },
      include: { faculty: { select: { departmentId: true } } },
    });

    // Defense in depth: only keep assignments whose faculty actually belongs
    // to this department. The query above already filters by the assignment's
    // own departmentId, but old/bad rows could still point to a faculty from
    // a different department — skipping them here stops a cross-department
    // FacultyResultSubmission from ever being created.
    const validAssignments = assignments.filter(
      (a) => a.faculty.departmentId === departmentId
    );

    // Auto-create one submission tracker row per valid assignment
    if (validAssignments.length > 0) {
      await tx.facultyResultSubmission.createMany({
        data: validAssignments.map((a) => ({
          schoolId,
          publicationId: publication.id,
          facultyId: a.facultyId,
          subjectId: a.subjectId,
          isSubmitted: false,
        })),
        skipDuplicates: true,
      });
    }

    return publication;
  });
}

async function findPublicationDuplicate(schoolId, sessionId, departmentId, batchYear, semesterNumber) {
  return prisma.resultPublication.findFirst({
    where: { schoolId, sessionId, departmentId, batchYear, semesterNumber },
  });
}

async function getPublicationsByDept(schoolId, departmentId) {
  return prisma.resultPublication.findMany({
    where: { schoolId, departmentId },
    include: {
      session: { select: { name: true } },
      facultyResultSubmissions: { select: { isSubmitted: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

async function getPublicationById(id, schoolId) {
  return prisma.resultPublication.findFirst({
    where: { id, schoolId },
    include: {
      session: { select: { name: true, academicYear: true } },
      facultyResultSubmissions: {
        include: {
          faculty: { include: { user: { select: { name: true, email: true } } } },
          subject: { select: { name: true, courseCode: true } },
        },
      },
    },
  });
}

async function updatePublicationStatus(id, status, hodUserId) {
  return prisma.resultPublication.update({
    where: { id },
    data: {
      status,
      ...(status === "published" && { publishedAt: new Date(), publishedByHodId: hodUserId }),
    },
  });
}

// ─── HOD Review ───────────────────────────────────────────────────────────────

async function getPendingSubmissions(publicationId, schoolId) {
  return prisma.facultyResultSubmission.findMany({
    where: { publicationId, schoolId, isSubmitted: false },
    include: {
      faculty: { include: { user: { select: { name: true, email: true } } } },
      subject: { select: { name: true, courseCode: true } },
    },
  });
}

async function getFailedMarks(publicationId) {
  return prisma.subjectMark.findMany({
    where: { publicationId, invalidatedAt: null, grade: "F" },
    include: {
      student: { include: { user: { select: { name: true, email: true } } } },
      subject: { select: { name: true, courseCode: true } },
    },
  });
}

// ─── Mark Upload ──────────────────────────────────────────────────────────────

/**
 * Returns subjects a faculty can submit marks for.
 * Only returns records where publication is in draft or under_review.
 */
async function getSubmittableSubjects(facultyId, schoolId) {
  return prisma.facultyResultSubmission.findMany({
    where: {
      schoolId,
      facultyId,
      publication: { status: { in: ["draft", "under_review"] } },
    },
    include: {
      publication: { select: { id: true, status: true, batchYear: true, semesterNumber: true } },
      subject: { select: { id: true, name: true, courseCode: true, totalMarks: true, passingMarks: true } },
    },
  });
}

/**
 * Replaces marks for a subject in a publication (delete old → insert fresh).
 * Flips FacultyResultSubmission.isSubmitted = true.
 * Returns whether ALL subjects are now submitted.
 */
async function upsertMarks(publicationId, facultyId, subjectId, semesterId, marksWithGrades, isReappear) {
  return prisma.$transaction(async (tx) => {
    // Delete existing marks for this subject (non-invalidated only)
    await tx.subjectMark.deleteMany({
      where: { publicationId, subjectId, isReappear: isReappear ?? false, invalidatedAt: null },
    });

    // Insert fresh marks (with grade + gradePoint already computed)
    await tx.subjectMark.createMany({
      data: marksWithGrades.map((m) => ({
        studentId: m.studentId,
        semesterId,
        subjectId,
        publicationId,
        marks: m.marks,
        grade: m.grade,
        gradePoint: m.gradePoint,
        gradingSystemId: m.gradingSystemId,
        isReappear: isReappear ?? false,
        invalidatedAt: null,
      })),
    });

    // Flip isSubmitted = true only for this faculty's row to avoid flipping
    // a co-assigned faculty's row for the same subject.
    await tx.facultyResultSubmission.updateMany({
      where: { publicationId, facultyId, subjectId },
      data: { isSubmitted: true, submittedAt: new Date() },
    });

    // Check if ALL subjects in this publication are now submitted
    const all = await tx.facultyResultSubmission.findMany({
      where: { publicationId },
      select: { isSubmitted: true },
    });

    return {
      allSubmitted: all.every((s) => s.isSubmitted),
      totalSubjects: all.length,
    };
  });
}

async function getFacultyMarksForSubject(publicationId, subjectId, facultyId, schoolId) {
  // First verify this faculty is assigned to this subject
  const submission = await prisma.facultyResultSubmission.findFirst({
    where: { publicationId, subjectId, facultyId, schoolId },
  });
  if (!submission) return null;

  return prisma.subjectMark.findMany({
    where: { publicationId, subjectId, invalidatedAt: null },
    include: { student: { include: { user: { select: { name: true } } } } },
    orderBy: { student: { rollNo: "asc" } },
  });
}

// ─── CGPA / SGPA ─────────────────────────────────────────────────────────────

async function getStudentMarksForPublication(studentId, publicationId) {
  return prisma.subjectMark.findMany({
    where: { studentId, publicationId, invalidatedAt: null },
    include: { subject: { select: { credits: true, passingMarks: true, totalMarks: true } } },
  });
}

async function getRegisteredStudentIds(schoolId, sessionId, batchYear, semesterNumber) {
  const rows = await prisma.studentSessionRegistration.findMany({
    where: { schoolId, sessionId, batchYear, semesterNumber },
    select: { studentId: true },
  });
  return rows.map((r) => r.studentId);
}

async function getAllCgpaRecords(studentId) {
  return prisma.cgpaRecord.findMany({
    where: { studentId },
    include: { semester: true },
    orderBy: { semester: { semesterNumber: "asc" } },
  });
}

async function upsertCgpaRecord(studentId, semesterId, sgpa, cgpa, totalCredits, classAvg) {
  return prisma.cgpaRecord.upsert({
    where: { studentId_semesterId: { studentId, semesterId } },
    update: { sgpa, cgpa, totalCredits, classAverageCgpa: classAvg },
    create: { studentId, semesterId, sgpa, cgpa, totalCredits, classAverageCgpa: classAvg },
  });
}

async function getSemesterByNumber(schoolId, semesterNumber) {
  return prisma.semester.findFirst({ where: { schoolId, semesterNumber } });
}

// ─── Student View ─────────────────────────────────────────────────────────────

async function getStudentResults(studentId, sessionId) {
  const where = {
    studentId,
    invalidatedAt: null,
    publication: { status: "published" },
  };
  if (sessionId) where.publication.sessionId = sessionId;

  return prisma.subjectMark.findMany({
    where,
    include: {
      subject: { select: { name: true, courseCode: true, credits: true, passingMarks: true, totalMarks: true } },
      publication: { select: { sessionId: true, semesterNumber: true, publishedAt: true } },
      semester: { select: { semesterNumber: true, name: true } },
    },
    orderBy: [{ publication: { semesterNumber: "asc" } }, { subject: { courseCode: "asc" } }],
  });
}

/**
 * getRosterForSubject — students registered for the publication's session/batch/semester,
 * with their existing mark for this subject attached (null if not submitted yet).
 *
 * This is the roster the mark-entry screen needs — independent of whether
 * marks have been submitted. Existing marks are LEFT-JOINED in manually
 * (Prisma has no relation between Student and SubjectMark filtered by subjectId,
 * so we fetch both lists and merge them by studentId in JS).
 */
async function getRosterForSubject(schoolId, sessionId, batchYear, semesterNumber, publicationId, subjectId) {
  // 1. Registered students for this session+batch+semester
  const registrations = await prisma.studentSessionRegistration.findMany({
    where: { schoolId, sessionId, batchYear, semesterNumber },
    include: {
      student: {
        include: { user: { select: { name: true, email: true } } },
      },
    },
    orderBy: { student: { rollNo: "asc" } },
  });

  // 2. Existing marks for this subject+publication (only non-invalidated)
  const existingMarks = await prisma.subjectMark.findMany({
    where: { publicationId, subjectId, invalidatedAt: null, isReappear: false },
  });

  // Map studentId -> mark row, for O(1) lookup while merging
  const markByStudentId = new Map(existingMarks.map((m) => [m.studentId, m]));

  // 3. Merge: every registered student, with mark fields null if not submitted
  return registrations.map((reg) => {
    const mark = markByStudentId.get(reg.studentId);
    return {
      student: {
        id: reg.student.id,
        rollNo: reg.student.rollNo,
        user: reg.student.user,
      },
      marks: mark?.marks ?? null,
      grade: mark?.grade ?? null,
      gradePoint: mark?.gradePoint ?? null,
    };
  });
}

async function getResultSummary(publicationId) {
  const marks = await prisma.subjectMark.findMany({
    where: { publicationId, invalidatedAt: null },
    include: {
      student: { include: { user: { select: { name: true } } } },
      subject: { select: { name: true, courseCode: true } },
    },
    orderBy: [{ subjectId: "asc" }, { student: { rollNo: "asc" } }],
  });

  const submissions = await prisma.facultyResultSubmission.findMany({
    where: { publicationId },
    include: { faculty: { include: { user: { select: { name: true } } } } },
  });

  const facultyBySubject = new Map(submissions.map((s) => [s.subjectId, s.faculty]));

  return marks.map((m) => ({ ...m, faculty: facultyBySubject.get(m.subjectId) ?? null }));
}

module.exports = {
  createPublication,
  findPublicationDuplicate,
  getPublicationsByDept,
  getPublicationById,
  updatePublicationStatus,
  getPendingSubmissions,
  getFailedMarks,
  getSubmittableSubjects,
  upsertMarks,
  getFacultyMarksForSubject,
  getStudentMarksForPublication,
  getRegisteredStudentIds,
  getAllCgpaRecords,
  upsertCgpaRecord,
  getSemesterByNumber,
  getStudentResults,
  getRosterForSubject,
  getResultSummary,
};
