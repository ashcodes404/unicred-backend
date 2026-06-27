// src/modules/reappear/reappear.service.js

const prisma = require("../../config/db");
const AppError = require("../../utils/AppError");
const { notify } = require("../../utils/notify");
const { computeSGPA, computeCGPA } = require("../../utils/grading");
const repo = require("./reappear.repository");
const resultsRepo = require("../results/results.repository");

// ─── Student ──────────────────────────────────────────────────────────────────

/**
 * Student applies for reappear on a subject they failed.
 * Validates:
 * 1. A published result exists with a failing grade for this subject+session
 * 2. No duplicate pending/approved application exists
 */
async function applyForReappear(studentId, schoolId, subjectId, sessionId, reason) {
  // Check there's a published failing mark for this subject+session
  const mark = await prisma.subjectMark.findFirst({
    where: {
      studentId, subjectId, invalidatedAt: null, isReappear: false,
      grade: "F", // Only F grade means failed
      publication: { sessionId, status: "published" },
    },
    include: {
      subject: { select: { name: true } },
      publication: { select: { semesterNumber: true } },
    },
  });
  if (!mark) throw new AppError(404, "No published failing result found for this subject in this session");

  // Block duplicate applications
  const duplicate = await repo.findDuplicate(studentId, subjectId, sessionId);
  if (duplicate) throw new AppError(409, `A ${duplicate.status} application already exists for this subject`);

  const application = await repo.createApplication(
    schoolId, studentId, subjectId, sessionId, mark.publication.semesterNumber, reason
  );

  // Notify HOD
  const student = await prisma.student.findFirst({
    where: { id: studentId },
    include: { user: { select: { name: true } }, department: { select: { hodUserId: true } } },
  });
  if (student?.department?.hodUserId) {
    await notify(
      student.department.hodUserId,
      "REAPPEAR_APPLICATION_RECEIVED",
      `${student.user.name} applied for reappear in ${mark.subject.name}.`,
      `/reappear/department`
    );
  }

  return application;
}

async function getMyApplications(studentId) {
  return repo.getStudentApplications(studentId);
}

async function withdrawApplication(applicationId, studentId) {
  const app = await prisma.reappearApplication.findFirst({ where: { id: applicationId, studentId } });
  if (!app) throw new AppError(404, "Application not found");
  if (app.status !== "pending") throw new AppError(400, `Cannot withdraw — application is ${app.status}`);
  return repo.deleteApplication(applicationId);
}

// ─── HOD ──────────────────────────────────────────────────────────────────────

async function getDeptApplications(schoolId, departmentId, status) {
  return repo.getDeptApplications(schoolId, departmentId, status);
}

/**
 * HOD approves a reappear application.
 * Invalidates the original mark → recomputes CGPA → notifies student.
 */
async function approveApplication(applicationId, schoolId, hodFacultyId, comment) {
  const app = await repo.getById(applicationId, schoolId);
  if (!app) throw new AppError(404, "Application not found");
  if (app.status !== "pending") throw new AppError(400, `Application is already ${app.status}`);

  await repo.approveApplication(applicationId, hodFacultyId, comment);

  // Invalidate original mark so it's excluded from CGPA
  const invalidatedMark = await repo.invalidateOriginalMark(app.studentId, app.subjectId, app.sessionId);

  // Recompute CGPA with the invalidated mark removed
  if (invalidatedMark) {
    await _recomputeGpa(app.studentId, app.schoolId, invalidatedMark.semesterId);
  }

  // Notify student
  const studentUser = app.student?.user;
  if (studentUser?.id) {
    await notify(
      studentUser.id,
      "REAPPEAR_APPROVED",
      `Your reappear application for ${app.subject.name} has been approved.`,
      `/reappear/my-applications`
    );
  }

  return { message: "Application approved. Original mark invalidated." };
}

async function rejectApplication(applicationId, schoolId, hodFacultyId, comment) {
  if (!comment?.trim()) throw new AppError(400, "Rejection reason is required");

  const app = await repo.getById(applicationId, schoolId);
  if (!app) throw new AppError(404, "Application not found");
  if (app.status !== "pending") throw new AppError(400, `Application is already ${app.status}`);

  await repo.rejectApplication(applicationId, hodFacultyId, comment);

  const studentUser = app.student?.user;
  if (studentUser?.id) {
    await notify(
      studentUser.id,
      "REAPPEAR_REJECTED",
      `Your reappear application for ${app.subject.name} was rejected. Reason: ${comment}`,
      `/reappear/my-applications`
    );
  }

  return { message: "Application rejected." };
}

// ─── Faculty ──────────────────────────────────────────────────────────────────

async function getActiveReappearStudents(facultyId, schoolId) {
  return repo.getActiveReappearForFaculty(facultyId, schoolId);
}

// ─── Internal Helper ──────────────────────────────────────────────────────────

/**
 * Recomputes SGPA and CGPA for a student after their mark set changes.
 * Called after:
 * - HOD approves reappear (original mark invalidated)
 * - Faculty submits reappear marks (new mark added)
 */
async function _recomputeGpa(studentId, schoolId, semesterId) {
  // Get all valid marks for this student in this semester
  const validMarks = await prisma.subjectMark.findMany({
    where: { studentId, semesterId, invalidatedAt: null },
    include: { subject: { select: { credits: true, passingMarks: true } } },
  });

  const subjectResults = validMarks.map((m) => ({
    credits: m.subject.credits,
    gradePoint: m.gradePoint ?? 0,
    isPassed: m.grade !== "F",
  }));

  const { sgpa, totalCredits } = computeSGPA(subjectResults);

  // Compute new CGPA using all semesters except the current one (we're replacing it)
  const otherSems = await prisma.cgpaRecord.findMany({
    where: { studentId, semesterId: { not: semesterId } },
  });
  const allSems = [
    ...otherSems.map((r) => ({ sgpa: r.sgpa, totalCredits: r.totalCredits })),
    { sgpa, totalCredits },
  ];
  const cgpa = computeCGPA(allSems);

  await resultsRepo.upsertCgpaRecord(studentId, semesterId, sgpa, cgpa, totalCredits, 0);
  return { sgpa, cgpa };
}

module.exports = {
  applyForReappear, getMyApplications, withdrawApplication,
  getDeptApplications, approveApplication, rejectApplication,
  getActiveReappearStudents, _recomputeGpa,
};
