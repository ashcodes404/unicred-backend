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

async function getDeptApplications(schoolId, departmentId, status) {
  return prisma.reappearApplication.findMany({
    where: {
      schoolId,
      ...(status ? { status } : {}),
      student: { departmentId },
    },
    include: {
      student: { include: { user: { select: { name: true, email: true } } } },
      subject: { select: { name: true, courseCode: true } },
      session: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
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
 */
async function getActiveReappearForFaculty(facultyId, schoolId) {
  const assignments = await prisma.facultyAssignment.findMany({
    where: { facultyId, schoolId },
    select: { subjectId: true, sessionId: true },
  });
  if (!assignments.length) return [];

  return prisma.reappearApplication.findMany({
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
}

module.exports = {
  createApplication, findDuplicate, getById, getStudentApplications,
  deleteApplication, getDeptApplications, approveApplication, rejectApplication,
  invalidateOriginalMark, getActiveReappearForFaculty,
};
