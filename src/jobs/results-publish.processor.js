// src/jobs/results-publish.processor.js
//
// Runs the heavy "publish results" fan-out in the background: for every
// student registered in the publication's session/batch/semester, compute
// SGPA -> cumulative CGPA -> upsert CgpaRecord -> notify. A batch can be
// hundreds of students, so this used to run inline inside the HTTP request
// that triggered the "published" status transition — now it runs as a
// BullMQ job (see src/queues/results.queue.js) so that request returns
// immediately.

const prisma = require("../config/db");
const AppError = require("../utils/AppError");
const { notify } = require("../utils/notify");
const { computeSGPA, computeCGPA } = require("../utils/grading");
const repo = require("../modules/results/results.repository");

async function processResultsPublishJob({ publicationId, schoolId, hodUserId }) {
  const pub = await repo.getPublicationById(publicationId, schoolId);
  if (!pub) throw new AppError(404, "Publication not found");

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

  await repo.updatePublicationStatus(pub.id, "published", hodUserId);

  // Let the HOD know the publish they kicked off has actually finished.
  try {
    await notify(
      hodUserId,
      "RESULT_PUBLISH_COMPLETE",
      `Results for ${session?.name ?? "the session"} (Semester ${pub.semesterNumber}) have been published to ${studentIds.length} student(s).`,
      `/results/publications/${pub.id}`
    );
  } catch (err) {
    console.error("Failed to send RESULT_PUBLISH_COMPLETE notification:", err);
  }
}

module.exports = { processResultsPublishJob };
