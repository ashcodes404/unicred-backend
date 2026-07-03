// src/modules/results/results.service.js

const prisma = require("../../config/db");
const AppError = require("../../utils/AppError");
const { notify } = require("../../utils/notify");
const { computeGrade } = require("../../utils/grading");
const gradingRepo = require("../grading/grading.repository");
const repo = require("./results.repository");
const { enqueueResultsPublish } = require("../../queues/results.queue");

// ─── Valid Status Transitions ─────────────────────────────────────────────────
// Maps current status → allowed next statuses
const VALID_TRANSITIONS = {
  draft: ["under_review"],
  under_review: ["frozen"],
  frozen: ["published", "under_review"], // can unfreeze for corrections
  published: [],
};

// ─── Publications ─────────────────────────────────────────────────────────────

async function createPublication(schoolId, sessionId, departmentId, batchYear, semesterNumber) {
  const existing = await repo.findPublicationDuplicate(schoolId, sessionId, departmentId, batchYear, semesterNumber);
  if (existing) throw new AppError(409, "A publication already exists for this session, dept, batch, and semester");

  return repo.createPublication(schoolId, sessionId, departmentId, batchYear, semesterNumber);
}

async function getPublications(schoolId, departmentId) {
  const pubs = await repo.getPublicationsByDept(schoolId, departmentId);

  // Attach completion % to each publication
  return pubs.map((p) => {
    const total = p.facultyResultSubmissions.length;
    const submitted = p.facultyResultSubmissions.filter((s) => s.isSubmitted).length;
    return { ...p, submittedCount: submitted, totalSubjects: total, completionPercent: total ? Math.round((submitted / total) * 100) : 0 };
  });
}

async function getPublication(id, schoolId) {
  const pub = await repo.getPublicationById(id, schoolId);
  if (!pub) throw new AppError(404, "Publication not found");

  const total = pub.facultyResultSubmissions.length;
  const submitted = pub.facultyResultSubmissions.filter((s) => s.isSubmitted).length;
  return { ...pub, submittedCount: submitted, totalSubjects: total, completionPercent: total ? Math.round((submitted / total) * 100) : 0 };
}

async function transitionStatus(publicationId, schoolId, newStatus, hodUserId) {
  const pub = await repo.getPublicationById(publicationId, schoolId);
  if (!pub) throw new AppError(404, "Publication not found");

  const allowed = VALID_TRANSITIONS[pub.status] || [];
  if (!allowed.includes(newStatus)) {
    throw new AppError(400, `Cannot move from "${pub.status}" to "${newStatus}". Allowed: ${allowed.join(", ") || "none"}`);
  }

  // Publishing requires all subjects to be submitted first
  if (newStatus === "published") {
    const pending = await repo.getPendingSubmissions(publicationId, schoolId);
    if (pending.length > 0) {
      throw new AppError(400, `Cannot publish — ${pending.length} subject(s) still pending submission`);
    }

    // The actual SGPA/CGPA recompute + notification fan-out can touch
    // hundreds of students, so it runs as a background job — this request
    // returns immediately. The publication's status flips to "published"
    // only once that job finishes (see results-publish.processor.js).
    await enqueueResultsPublish({ publicationId, schoolId, hodUserId });

    return { ...pub, publishing: true };
  }

  return repo.updatePublicationStatus(publicationId, newStatus, hodUserId);
}

// ─── Mark Upload ──────────────────────────────────────────────────────────────

async function submitMarks(facultyId, schoolId, publicationId, subjectId, marks, isReappear = false) {
  const pub = await repo.getPublicationById(publicationId, schoolId);
  if (!pub) throw new AppError(404, "Publication not found");

  // For NORMAL marks: block if frozen or published.
  // For REAPPEAR marks: allow even when published — reappear happens AFTER publish.
  if (!isReappear && (pub.status === "frozen" || pub.status === "published")) {
    throw new AppError(403, "Publication is frozen/published. Ask HOD to unfreeze.");
  }

  // Reappear marks can only be submitted on an already-published result
  if (isReappear && pub.status !== "published") {
    throw new AppError(403, "Reappear marks can only be submitted after the result is published.");
  }

  // Verify faculty is assigned to this subject
  const assignment = await prisma.facultyAssignment.findFirst({
    where: { schoolId, sessionId: pub.sessionId, facultyId, subjectId, batchYear: pub.batchYear, semesterNumber: pub.semesterNumber },
  });
  if (!assignment) throw new AppError(403, "You are not assigned to this subject for this session");

  // Get subject to validate marks + passingMarks
  const subject = await prisma.subject.findFirst({ where: { id: subjectId, schoolId } });
  if (!subject) throw new AppError(404, "Subject not found");

  const bad = marks.find((m) => m.marks < 0 || m.marks > subject.totalMarks);
  if (bad) throw new AppError(400, `Marks must be between 0 and ${subject.totalMarks}. Invalid: ${bad.marks}`);

  // Get school's active grading system
  const gradingSystem = await gradingRepo.getActiveSystemForSchool(schoolId);
  if (!gradingSystem) throw new AppError(500, "No grading system found");

  // Compute grade for each student
  const marksWithGrades = marks.map((m) => {
    const { grade, gradePoint } = computeGrade(m.marks, subject.totalMarks, subject.passingMarks, gradingSystem.rules);
    return { studentId: m.studentId, marks: m.marks, grade, gradePoint, gradingSystemId: gradingSystem.id };
  });

  const semester = await repo.getSemesterByNumber(schoolId, pub.semesterNumber);
  if (!semester) throw new AppError(500, "Semester record not found");

  const { allSubmitted, totalSubjects } = await repo.upsertMarks(
    publicationId, facultyId, subjectId, semester.id, marksWithGrades, isReappear
  );

  // If all subjects submitted → notify HOD
  if (allSubmitted) {
    const dept = await prisma.department.findFirst({ where: { id: pub.departmentId }, select: { hodUserId: true } });
    if (dept?.hodUserId) {
      await notify(
        dept.hodUserId,
        "RESULT_COMPILATION_COMPLETE",
        `All ${totalSubjects} subjects submitted for Semester ${pub.semesterNumber}. Ready for review.`,
        `/results/publications/${publicationId}`
      );
    }
  }

  // For REAPPEAR marks: recompute each student's CGPA and notify them.
  // (The original failing mark was already invalidated when HOD approved the reappear.)
  if (isReappear) {
    const reappearService = require("../reappear/reappear.service");
    for (const m of marksWithGrades) {
      // Recompute SGPA + CGPA now that the new reappear mark is in
      await reappearService._recomputeGpa(m.studentId, schoolId, semester.id);

      // Notify the student their reappear result is out
      const student = await prisma.student.findFirst({
        where: { id: m.studentId }, include: { user: { select: { id: true } } },
      });
      if (student?.user?.id) {
        await notify(
          student.user.id,
          "REAPPEAR_RESULT_PUBLISHED",
          `Your reappear result for ${subject.name} is published. New grade: ${m.grade}.`,
          `/results/session/${pub.sessionId}`
        );
      }
    }
  }

  return { submitted: marks.length, allSubmitted, isReappear };
}

// Publish fan-out (SGPA/CGPA recompute + notifications) now lives in
// src/jobs/results-publish.processor.js, run via the results-publish queue.

// ─── Getters ──────────────────────────────────────────────────────────────────

async function getPendingSubmissions(publicationId, schoolId) {
  return repo.getPendingSubmissions(publicationId, schoolId);
}

async function getFailedStudents(publicationId, schoolId) {
  return repo.getFailedMarks(publicationId);
}

async function getSubmittableSubjects(facultyId, schoolId) {
  return repo.getSubmittableSubjects(facultyId, schoolId);
}

async function getFacultyMarks(publicationId, subjectId, facultyId, schoolId) {
  const marks = await repo.getFacultyMarksForSubject(publicationId, subjectId, facultyId, schoolId);
  if (marks === null) throw new AppError(403, "You are not assigned to this subject");
  return marks;
}

async function getStudentResults(studentId, sessionId) {
  const marks = await repo.getStudentResults(studentId, sessionId);
  return marks.map((m) => ({ ...m, isPassed: m.grade !== "F" }));
}

async function getStudentCgpa(studentId) {
  return repo.getAllCgpaRecords(studentId);
}

/**
 * getRoster — full student roster for a subject's mark-entry screen.
 * Verifies the faculty is assigned to this subject before returning anything,
 * same security check used in getFacultyMarks.
 */
async function getRoster(facultyId, schoolId, publicationId, subjectId) {
  const pub = await repo.getPublicationById(publicationId, schoolId);
  if (!pub) throw new AppError(404, "Publication not found");

  // Same assignment check used in submitMarks — only the assigned faculty
  // (or HOD acting as faculty) can view the roster for this subject.
  const assignment = await prisma.facultyAssignment.findFirst({
    where: { schoolId, sessionId: pub.sessionId, facultyId, subjectId, batchYear: pub.batchYear, semesterNumber: pub.semesterNumber },
  });
  if (!assignment) throw new AppError(403, "You are not assigned to this subject for this session");

  return repo.getRosterForSubject(schoolId, pub.sessionId, pub.batchYear, pub.semesterNumber, publicationId, subjectId);
}

async function getResultSummary(publicationId, schoolId) {
  const pub = await repo.getPublicationById(publicationId, schoolId);
  if (!pub) throw new AppError(404, "Publication not found");
  return repo.getResultSummary(publicationId);
}

module.exports = {
  createPublication,
  getPublications,
  getPublication,
  transitionStatus,
  submitMarks,
  getPendingSubmissions,
  getFailedStudents,
  getSubmittableSubjects,
  getFacultyMarks,
  getStudentResults,
  getStudentCgpa,
  getRoster,
  getResultSummary,
};