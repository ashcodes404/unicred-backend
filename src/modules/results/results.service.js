// src/modules/results/results.service.js

const prisma = require("../../config/db");
const AppError = require("../../utils/AppError");
const { notify } = require("../../utils/notify");
const { computeGrade, computeSGPA, computeCGPA } = require("../../utils/grading");
const gradingRepo = require("../grading/grading.repository");
const repo = require("./results.repository");

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
    return _publishResult(pub, hodUserId);
  }

  return repo.updatePublicationStatus(publicationId, newStatus, hodUserId);
}

// ─── Mark Upload ──────────────────────────────────────────────────────────────

async function submitMarks(facultyId, schoolId, publicationId, subjectId, marks, isReappear = false) {
  const pub = await repo.getPublicationById(publicationId, schoolId);
  if (!pub) throw new AppError(404, "Publication not found");

  if (pub.status === "frozen" || pub.status === "published") {
    throw new AppError(403, "Publication is frozen/published. Ask HOD to unfreeze.");
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
    publicationId, subjectId, semester.id, marksWithGrades, isReappear
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

  return { submitted: marks.length, allSubmitted, isReappear };
}

// ─── Publish Flow ─────────────────────────────────────────────────────────────

/**
 * Called when HOD transitions status to "published".
 * For every registered student: compute SGPA → compute CGPA → upsert CgpaRecord → notify.
 */
async function _publishResult(pub, hodUserId) {
  const session = await prisma.academicSession.findFirst({
    where: { id: pub.sessionId }, select: { name: true },
  });

  const semester = await repo.getSemesterByNumber(pub.schoolId, pub.semesterNumber);
  if (!semester) throw new AppError(500, "Semester record not found");

  const studentIds = await repo.getRegisteredStudentIds(pub.schoolId, pub.sessionId, pub.batchYear, pub.semesterNumber);

  // Process all students concurrently
  await Promise.all(
    studentIds.map(async (studentId) => {
      const studentMarks = await repo.getStudentMarksForPublication(studentId, pub.id);
      if (!studentMarks.length) return;

      // Build input for SGPA computation
      const subjectResults = studentMarks.map((m) => ({
        credits: m.subject.credits,
        gradePoint: m.gradePoint ?? 0,
        isPassed: m.marks >= m.subject.passingMarks,
      }));

      const { sgpa, totalCredits } = computeSGPA(subjectResults);

      // Get previous semester records to compute cumulative CGPA
      const prevRecords = await repo.getAllCgpaRecords(studentId);
      const allSems = [
        ...prevRecords.map((r) => ({ sgpa: r.sgpa, totalCredits: r.totalCredits })),
        { sgpa, totalCredits },
      ];
      const cgpa = computeCGPA(allSems);

      await repo.upsertCgpaRecord(studentId, semester.id, sgpa, cgpa, totalCredits, 0);

      // Notify student about failed subjects
      const student = await prisma.student.findFirst({
        where: { id: studentId }, include: { user: { select: { id: true } } },
      });
      if (!student) return;

      for (const m of studentMarks) {
        if (m.grade === "F") {
          const subj = await prisma.subject.findFirst({ where: { id: m.subjectId }, select: { name: true } });
          await notify(student.user.id, "RESULT_FAIL", `You failed ${subj?.name ?? "a subject"}. You may apply for reappear.`, `/results/session/${pub.sessionId}`);
        }
      }

      await notify(student.user.id, "RESULT_PUBLISHED", `Results for ${session?.name ?? "your session"} are published.`, `/results/session/${pub.sessionId}`);
    })
  );

  // Compute batch average CGPA and update all records for this semester
  const semRecords = await prisma.cgpaRecord.findMany({
    where: { semesterId: semester.id, studentId: { in: studentIds } },
  });
  if (semRecords.length) {
    const avg = parseFloat((semRecords.reduce((s, r) => s + r.cgpa, 0) / semRecords.length).toFixed(2));
    await prisma.cgpaRecord.updateMany({
      where: { semesterId: semester.id, studentId: { in: studentIds } },
      data: { classAverageCgpa: avg },
    });
  }

  return repo.updatePublicationStatus(pub.id, "published", hodUserId);
}

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
};
