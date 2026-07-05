// src/modules/reappear/reappear.repository.js

const prisma = require("../../config/db");

async function createApplication(schoolId, studentId, subjectId, sessionId, semesterNumber, reason) {
  return prisma.reappearApplication.create({
    data: { schoolId, studentId, subjectId, sessionId, semesterNumber, reason },
    include: {
      subject: { select: { name: true, courseCode: true } },
      session: { select: { name: true } },
    },
  });
}

/**
 * Finds an existing pending/approved application for the same subject+session.
 * Prevents duplicate applications.
 */
async function findDuplicate(studentId, subjectId, sessionId) {
  return prisma.reappearApplication.findFirst({
    where: { studentId, subjectId, sessionId, status: { in: ["pending", "approved"] } },
  });
}

async function getById(id, schoolId) {
  return prisma.reappearApplication.findFirst({
    where: { id, schoolId },
    include: {
      student: { include: { user: { select: { id: true, name: true, email: true } } } },
      subject: { select: { name: true, courseCode: true } },
      session: { select: { name: true } },
    },
  });
}

async function getStudentApplications(studentId) {
  return prisma.reappearApplication.findMany({
    where: { studentId },
    include: {
      subject: { select: { name: true, courseCode: true } },
      session: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

async function deleteApplication(id) {
  return prisma.reappearApplication.delete({ where: { id } });
}

/**
 * WHAT: Every reappear application in one department, optionally filtered
 *       by status. Scoped by BOTH schoolId (this app's multi-tenancy rule —
 *       see tenant.middleware.js) AND departmentId (via the student's own
 *       department), so an HOD can only ever see their own department's
 *       applications, never another department's or another school's.
 * WHY: Powers GET /api/reappear/department. Wrapped in try/catch so a
 *      failure logs the exact inputs and the real Prisma error message to
 *      the server console BEFORE it reaches the generic global error
 *      handler — that handler only logs the bare error object, which for a
 *      Prisma "inconsistent query result" error (e.g. a reappear
 *      application whose linked session/subject/student was deleted after
 *      the fact — a real risk under this schema's relationMode="prisma",
 *      which does NOT enforce foreign keys at the database level) doesn't
 *      always make the actual cause obvious at a glance.
 */
// skip/limit are optional — hod/Dashboard.jsx's pending-applications widget
// relies on getting the full (typically small, "pending only") list back,
// so this only paginates when explicitly asked (e.g. a future full
// department-applications list page, which can accumulate every semester).
async function getDeptApplications(schoolId, departmentId, status, { skip, limit } = {}) {
  const where = {
    schoolId,
    ...(status ? { status } : {}),
    // deletedAt: null matches the same soft-delete convention every
    // other department-scoped query in this app already follows (see
    // syllabus.service.js's notifyDepartmentOfSyllabus, for example) —
    // a student who was later deactivated shouldn't still show up here.
    student: { departmentId, deletedAt: null },
  };
  const include = {
    student: { include: { user: { select: { name: true, email: true } } } },
    subject: { select: { name: true, courseCode: true } },
    session: { select: { name: true } },
  };

  try {
    if (skip === undefined) {
      return await prisma.reappearApplication.findMany({ where, include, orderBy: { createdAt: "desc" } });
    }
    const [rows, total] = await Promise.all([
      prisma.reappearApplication.findMany({ where, include, orderBy: { createdAt: "desc" }, skip, take: limit }),
      prisma.reappearApplication.count({ where }),
    ]);
    return { rows, total };
  } catch (err) {
    console.error(
      `[reappear] getDeptApplications failed — schoolId=${schoolId} departmentId=${departmentId} status=${status ?? "(all)"}:`,
      err
    );
    throw err;
  }
}

async function approveApplication(id, hodFacultyId, comment) {
  return prisma.reappearApplication.update({
    where: { id },
    data: { status: "approved", hodComment: comment, reviewedByHodId: hodFacultyId, reviewedAt: new Date() },
  });
}

async function rejectApplication(id, hodFacultyId, comment) {
  return prisma.reappearApplication.update({
    where: { id },
    data: { status: "rejected", hodComment: comment, reviewedByHodId: hodFacultyId, reviewedAt: new Date() },
  });
}

/**
 * Sets invalidatedAt on the student's original (non-reappear) mark for this subject.
 * The invalidated mark is excluded from all CGPA computations and student result views.
 */
async function invalidateOriginalMark(studentId, subjectId, sessionId) {
  const mark = await prisma.subjectMark.findFirst({
    where: {
      studentId, subjectId, isReappear: false, invalidatedAt: null,
      publication: { sessionId },
    },
  });
  if (!mark) return null;

  await prisma.subjectMark.update({ where: { id: mark.id }, data: { invalidatedAt: new Date() } });
  return mark;
}

/**
 * Gets all approved reappear applications for subjects assigned to a faculty.
 *
 * Each returned row also carries a resolved `publicationId`. The
 * reappearApplication table has no direct foreign key to a ResultPublication,
 * but POST /results/submit-reappear requires one. ResultPublication has a
 * unique index on (sessionId, departmentId, batchYear, semesterNumber), and
 * an application's session/semester plus its student's department/batchYear
 * are exactly that key — so we look up the matching PUBLISHED publication
 * for each application and attach its id. A batched findMany (one extra
 * query total) is used instead of one lookup per application to avoid N+1
 * queries.
 */
async function getActiveReappearForFaculty(facultyId, schoolId) {
  const assignments = await prisma.facultyAssignment.findMany({
    where: { facultyId, schoolId },
    select: { subjectId: true, sessionId: true },
  });
  if (!assignments.length) return [];

  const applications = await prisma.reappearApplication.findMany({
    where: {
      schoolId,
      status: "approved",
      OR: assignments.map((a) => ({ subjectId: a.subjectId, sessionId: a.sessionId })),
    },
    include: {
      student: { include: { user: { select: { name: true, email: true } } } },
      subject: { select: { name: true, courseCode: true } },
      session: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  if (!applications.length) return [];

  // Fetch every PUBLISHED publication that could match any application's
  // (sessionId, departmentId, batchYear, semesterNumber) combo, in one query.
  const publications = await prisma.resultPublication.findMany({
    where: {
      status: "published",
      OR: applications.map((a) => ({
        sessionId: a.sessionId,
        departmentId: a.student.departmentId,
        batchYear: a.student.batchYear,
        semesterNumber: a.semesterNumber,
      })),
    },
    select: { id: true, sessionId: true, departmentId: true, batchYear: true, semesterNumber: true },
  });

  // Join key built from the same 4 fields on both sides, so each application
  // can find its match in a Map lookup instead of re-scanning the list.
  const keyOf = (o) => `${o.sessionId}_${o.departmentId}_${o.batchYear}_${o.semesterNumber}`;
  const publicationIdByKey = new Map(publications.map((p) => [keyOf(p), p.id]));

  return applications.map((a) => ({
    ...a,
    // null when no published publication exists yet for this combo — the
    // frontend should treat that as "not ready to submit reappear marks".
    publicationId: publicationIdByKey.get(
      keyOf({
        sessionId:      a.sessionId,
        departmentId:   a.student.departmentId,
        batchYear:      a.student.batchYear,
        semesterNumber: a.semesterNumber,
      })
    ) ?? null,
  }));
}

module.exports = {
  createApplication, findDuplicate, getById, getStudentApplications,
  deleteApplication, getDeptApplications, approveApplication, rejectApplication,
  invalidateOriginalMark, getActiveReappearForFaculty,
};
