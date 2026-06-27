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

    // Find all faculty assigned to this session+batch+semester
    const assignments = await tx.facultyAssignment.findMany({
      where: { schoolId, sessionId, batchYear, semesterNumber },
    });

    // Auto-create one submission tracker row per assignment
    if (assignments.length > 0) {
      await tx.facultyResultSubmission.createMany({
        data: assignments.map((a) => ({
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
async function upsertMarks(publicationId, subjectId, semesterId, marksWithGrades, isReappear) {
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

    // Flip isSubmitted = true for this subject's submission tracker
    await tx.facultyResultSubmission.updateMany({
      where: { publicationId, subjectId },
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
};
