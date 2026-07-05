/**
 * MANUAL TEST SCRIPT — Admin-configurable grading method (absolute <-> relative)
 * =========================================================================
 * Postman-collection-style script (same convention as
 * scripts/test-security-audit-fixes.js): builds throwaway fixtures with
 * Prisma, mints JWTs directly, drives the REAL running API with fetch(),
 * and checks the responses. Everything created here is deleted again in
 * the `finally` block, pass or fail.
 *
 * Run with the backend dev server already running (npm run dev), then:
 *   node scripts/test-grading-method.js
 *
 * COVERS:
 *   1. GET /api/grading-systems/method defaults to "absolute"
 *   2. PATCH without acknowledged=true is rejected (400) — server-side,
 *      not just a frontend checkbox
 *   3. PATCH by a non-admin (HOD) is rejected (403)
 *   4. PATCH switches the method, and GET reflects it afterwards
 *   5. PATCH to the SAME method again is rejected (400, avoids notification spam)
 *   6. Switching notifies every OTHER user in the school (HOD, faculty,
 *      student) but NOT the admin who made the change
 *   7. submitMarks under "relative" produces a bell-curve grade spread
 *      matching the worked example verified earlier against
 *      computeRelativeGrades() directly
 *   8. Reappear marks ALWAYS use absolute grading, even while the school
 *      is set to "relative"
 *   9. Switching the method back to "absolute" does NOT change grades
 *      already stored from the "relative" submission above (past results
 *      untouched — only future submitMarks calls are affected)
 */

const prisma = require("../src/config/db");
const { signAccessToken } = require("../src/utils/jwt");
const { hashPassword } = require("../src/utils/hash");

const BASE_URL = "http://localhost:5000/api";
const STAMP = Date.now();

let passCount = 0;
let failCount = 0;
function check(label, condition) {
  if (condition) {
    passCount++;
    console.log(`  PASS  ${label}`);
  } else {
    failCount++;
    console.log(`  FAIL  ${label}`);
  }
}

async function api(token, method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

function tokenFor(user) {
  return signAccessToken({ userId: user.id, role: user.role, schoolId: user.schoolId });
}

const ids = { users: [], school: null, department: null, faculty: [], students: [], session: null, subject: null, assignment: null, registrations: [], publication: null, semester: null };

async function createUser({ schoolId, role, email, name }) {
  const user = await prisma.user.create({
    data: { schoolId, role, email, name, passwordHash: await hashPassword("Test@1234"), emailVerified: true },
  });
  ids.users.push(user.id);
  return user;
}

async function main() {
  console.log("Setting up fixture data...");

  const school = await prisma.school.create({ data: { name: `Grading Method School ${STAMP}`, domain: `grading-method-${STAMP}.edu` } });
  ids.school = school.id;

  const dept = await prisma.department.create({ data: { schoolId: school.id, name: `Dept ${STAMP}` } });
  ids.department = dept.id;

  const admin = await createUser({ schoolId: school.id, role: "admin", email: `admin-${STAMP}@test.com`, name: "Admin" });
  const hodUser = await createUser({ schoolId: school.id, role: "hod", email: `hod-${STAMP}@test.com`, name: "Hod" });
  const facUser = await createUser({ schoolId: school.id, role: "faculty", email: `fac-${STAMP}@test.com`, name: "Faculty" });

  const hodFac = await prisma.faculty.create({ data: { userId: hodUser.id, schoolId: school.id, departmentId: dept.id, designation: "HOD" } });
  const fac = await prisma.faculty.create({ data: { userId: facUser.id, schoolId: school.id, departmentId: dept.id, designation: "Professor" } });
  ids.faculty.push(hodFac.id, fac.id);
  await prisma.department.update({ where: { id: dept.id }, data: { hodUserId: hodUser.id } });

  // 7 students so we have a real spread of marks to curve against.
  const studentMarks = [95, 85, 75, 65, 55, 45, 35]; // last one fails (< passingMarks 40)
  const studentUsers = [];
  const students = [];
  for (let i = 0; i < studentMarks.length; i++) {
    const su = await createUser({ schoolId: school.id, role: "student", email: `stu${i}-${STAMP}@test.com`, name: `Student ${i}` });
    studentUsers.push(su);
    const st = await prisma.student.create({
      data: { userId: su.id, schoolId: school.id, departmentId: dept.id, rollNo: `R${i}-${STAMP}`, branch: "CS", batchYear: 2024, currentSemester: 3, graduationYear: 2028 },
    });
    students.push(st);
    ids.students.push(st.id);
  }

  const session = await prisma.academicSession.create({
    data: {
      schoolId: school.id, departmentId: dept.id, name: `Sem ${STAMP}`, academicYear: "2025-26",
      semesterType: "odd", startDate: new Date(), endDate: new Date(Date.now() + 2592000000),
      status: "active", createdByUserId: hodUser.id,
    },
  });
  ids.session = session.id;

  const subject = await prisma.subject.create({
    data: { schoolId: school.id, departmentId: dept.id, name: `Subject ${STAMP}`, courseCode: `CS${STAMP % 1000}`, totalMarks: 100, passingMarks: 40 },
  });
  ids.subject = subject.id;

  const semester = await prisma.semester.create({ data: { schoolId: school.id, semesterNumber: 3, name: `Semester 3 ${STAMP}` } });
  ids.semester = semester.id;

  const assignment = await prisma.facultyAssignment.create({
    data: { schoolId: school.id, sessionId: session.id, facultyId: fac.id, subjectId: subject.id, departmentId: dept.id, semesterNumber: 3, batchYear: 2024, assignedByHodId: hodUser.id },
  });
  ids.assignment = assignment.id;

  for (const st of students) {
    const reg = await prisma.studentSessionRegistration.create({
      data: { schoolId: school.id, studentId: st.id, sessionId: session.id, semesterNumber: 3, batchYear: 2024 },
    });
    ids.registrations.push(reg.id);
  }

  const publication = await prisma.resultPublication.create({
    data: { schoolId: school.id, sessionId: session.id, departmentId: dept.id, batchYear: 2024, semesterNumber: 3, status: "draft" },
  });
  ids.publication = publication.id;

  console.log("Fixture ready.\n");

  const tAdmin = tokenFor(admin);
  const tHod = tokenFor(hodUser);
  const tFac = tokenFor(facUser);

  // =========================================================================
  console.log("1. Default grading method");
  // =========================================================================
  {
    const r = await api(tAdmin, "GET", "/grading-systems/method");
    check("GET /method -> 200", r.status === 200);
    check('defaults to "absolute"', r.json?.data?.gradingMethod === "absolute");
  }

  // =========================================================================
  console.log("\n2. PATCH validation");
  // =========================================================================
  {
    const noAck = await api(tAdmin, "PATCH", "/grading-systems/method", { gradingMethod: "relative" });
    check("PATCH without acknowledged=true -> 400", noAck.status === 400);

    const byHod = await api(tHod, "PATCH", "/grading-systems/method", { gradingMethod: "relative", acknowledged: true });
    check("PATCH by a non-admin (HOD) -> 403", byHod.status === 403);
  }

  // =========================================================================
  console.log("\n3. Switch to relative + notification fan-out");
  // =========================================================================
  {
    const switchToRelative = await api(tAdmin, "PATCH", "/grading-systems/method", { gradingMethod: "relative", acknowledged: true });
    check("PATCH to relative -> 200", switchToRelative.status === 200);
    check('response reflects "relative"', switchToRelative.json?.data?.gradingMethod === "relative");

    const getAfter = await api(tAdmin, "GET", "/grading-systems/method");
    check('GET now returns "relative"', getAfter.json?.data?.gradingMethod === "relative");

    const sameMethodAgain = await api(tAdmin, "PATCH", "/grading-systems/method", { gradingMethod: "relative", acknowledged: true });
    check("PATCH to the SAME method again -> 400", sameMethodAgain.status === 400);

    // Notification fan-out: HOD/faculty/every student notified, admin (the
    // actor) is not.
    const hodNotified = await prisma.notification.findFirst({ where: { userId: hodUser.id, type: "GRADING_METHOD_CHANGED" } });
    check("HOD was notified", !!hodNotified);
    const facNotified = await prisma.notification.findFirst({ where: { userId: facUser.id, type: "GRADING_METHOD_CHANGED" } });
    check("Faculty was notified", !!facNotified);
    const studentNotified = await prisma.notification.findFirst({ where: { userId: studentUsers[0].id, type: "GRADING_METHOD_CHANGED" } });
    check("A student was notified", !!studentNotified);
    const adminNotified = await prisma.notification.findFirst({ where: { userId: admin.id, type: "GRADING_METHOD_CHANGED" } });
    check("Admin (the actor) was NOT notified", !adminNotified);
  }

  // =========================================================================
  console.log("\n4. submitMarks under relative grading — bell-curve spread");
  // =========================================================================
  {
    const marksPayload = students.map((st, i) => ({ studentId: st.id, marks: studentMarks[i] }));
    const submit = await api(tFac, "POST", "/results/submit", {
      publicationId: publication.id,
      subjectId: subject.id,
      marks: marksPayload,
    });
    check("submitMarks under relative -> 200", submit.status === 200);

    const stored = await prisma.subjectMark.findMany({
      where: { publicationId: publication.id, subjectId: subject.id },
      select: { studentId: true, marks: true, grade: true },
    });
    const byStudentId = new Map(stored.map((s) => [s.studentId, s]));

    // Matches the worked example already verified directly against
    // computeRelativeGrades(): symmetric marks around the mean (70) with
    // stdDev ~17.08 produce a clean, evenly spread curve.
    const expected = { 0: "O", 1: "A+", 2: "A", 3: "B+", 4: "B", 5: "C", 6: "F" };
    for (let i = 0; i < students.length; i++) {
      const row = byStudentId.get(students[i].id);
      check(`student ${i} (marks=${studentMarks[i]}) graded "${expected[i]}"`, row?.grade === expected[i]);
    }
  }

  // =========================================================================
  console.log("\n5. Reappear marks always use absolute grading, even under relative setting");
  // =========================================================================
  {
    // Publish isn't required for this check — reappear marks just need
    // the publication to be "published" per submitMarks' own rule, so
    // flip it there directly (bypassing the full publish job/pipeline,
    // which isn't what this test is about).
    await prisma.resultPublication.update({ where: { id: publication.id }, data: { status: "published" } });

    // A mid-pack mark (65) that landed on "B+" under the relative curve
    // above. Under ABSOLUTE grading with the seeded default rules
    // (60-69.99% -> B+, gradePoint 7) it should land on exactly the same
    // grade here — not a meaningful test of "did it use absolute" by
    // itself, so instead directly compare against a mark that the curve
    // and the absolute scale disagree on: 55 marks curved to "B" above,
    // but under ABSOLUTE fixed bands (50-59.99% -> B) it's... also B.
    // Use a value where the two methods clearly diverge instead: 90 marks
    // is comfortably within the absolute "O" band (90-100%) - reappear
    // students only ever resubmit ONE subject's mark for themselves, so
    // there's no "cohort" at all (n=1) - computeRelativeGrades would
    // already fall back to absolute for a single mark. To prove the
    // isReappear branch itself (not just the n<2 fallback) is what's
    // forcing absolute grading, submit a REAPPEAR batch of 2+ marks that
    // WOULD curve differently if relative grading were mistakenly applied.
    const reappearMarks = [{ studentId: students[6].id, marks: 92 }, { studentId: students[5].id, marks: 44 }];
    const submitReappear = await api(tFac, "POST", "/results/submit-reappear", {
      publicationId: publication.id,
      subjectId: subject.id,
      marks: reappearMarks,
    });
    check("submit-reappear -> 200", submitReappear.status === 200);

    const reappearStored = await prisma.subjectMark.findMany({
      where: { publicationId: publication.id, subjectId: subject.id, invalidatedAt: null, marks: { in: [92, 44] } },
      select: { marks: true, grade: true },
    });
    const g92 = reappearStored.find((r) => r.marks === 92)?.grade;
    const g44 = reappearStored.find((r) => r.marks === 44)?.grade;
    // Absolute bands: 92% -> O, 44% -> C. If relative grading had been
    // wrongly applied to just these 2 reappear marks, the curve between
    // only 92 and 44 would produce a completely different split.
    check(`reappear mark 92 graded "O" (absolute band, not curved)`, g92 === "O");
    check(`reappear mark 44 graded "C" (absolute band, not curved)`, g44 === "C");
  }

  // =========================================================================
  console.log("\n6. Switching back to absolute does not touch past results");
  // =========================================================================
  {
    const before = await prisma.subjectMark.findMany({
      where: { publicationId: publication.id, subjectId: subject.id, invalidatedAt: null },
      select: { studentId: true, grade: true },
      orderBy: { studentId: "asc" },
    });

    const switchBack = await api(tAdmin, "PATCH", "/grading-systems/method", { gradingMethod: "absolute", acknowledged: true });
    check("PATCH back to absolute -> 200", switchBack.status === 200);

    const after = await prisma.subjectMark.findMany({
      where: { publicationId: publication.id, subjectId: subject.id, invalidatedAt: null },
      select: { studentId: true, grade: true },
      orderBy: { studentId: "asc" },
    });

    const unchanged = JSON.stringify(before) === JSON.stringify(after);
    check("previously stored grades are byte-for-byte unchanged after switching method", unchanged);
  }

  console.log(`\n${passCount} passed, ${failCount} failed.`);
}

main()
  .catch((err) => {
    console.error("Script crashed:", err);
    failCount++;
  })
  .finally(async () => {
    console.log("\nCleaning up fixture data...");
    await prisma.subjectMark.deleteMany({ where: { publicationId: ids.publication } }).catch(() => {});
    await prisma.facultyResultSubmission.deleteMany({ where: { publicationId: ids.publication } }).catch(() => {});
    await prisma.resultPublication.deleteMany({ where: { id: ids.publication } }).catch(() => {});
    await prisma.studentSessionRegistration.deleteMany({ where: { id: { in: ids.registrations } } }).catch(() => {});
    await prisma.facultyAssignment.deleteMany({ where: { id: ids.assignment } }).catch(() => {});
    await prisma.subject.deleteMany({ where: { id: ids.subject } }).catch(() => {});
    await prisma.semester.deleteMany({ where: { id: ids.semester } }).catch(() => {});
    await prisma.academicSession.deleteMany({ where: { id: ids.session } }).catch(() => {});
    await prisma.student.deleteMany({ where: { id: { in: ids.students } } }).catch(() => {});
    await prisma.faculty.deleteMany({ where: { id: { in: ids.faculty } } }).catch(() => {});
    await prisma.department.updateMany({ where: { id: ids.department }, data: { hodUserId: null } }).catch(() => {});
    await prisma.notification.deleteMany({ where: { userId: { in: ids.users } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } }).catch(() => {});
    await prisma.department.deleteMany({ where: { id: ids.department } }).catch(() => {});
    await prisma.school.deleteMany({ where: { id: ids.school } }).catch(() => {});
    console.log("Cleanup done.");
    await prisma.$disconnect();
    process.exit(failCount > 0 ? 1 : 0);
  });
