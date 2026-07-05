/**
 * MANUAL TEST SCRIPT — Security audit fixes (production-hardening pass)
 * =========================================================================
 * This repo has no Jest/Mocha suite, so this is a Postman-collection-style
 * script (same convention as scripts/test-announcements.js): builds a small
 * throwaway set of schools/departments/users directly with Prisma, mints
 * JWTs with signAccessToken() (skipping login), drives the REAL running API
 * with fetch(), and checks the responses. Everything created here is
 * deleted again in the `finally` block, pass or fail.
 *
 * Run with the backend dev server already running (npm run dev), then:
 *   node scripts/test-security-audit-fixes.js
 *
 * COVERS (one section per critical/high fix from the audit):
 *   1. auth.service.js invite() — HOD can no longer create hod/admin accounts
 *   2. faculty.service.js createFaculty() — cross-school userId is rejected
 *   3. students.service.js updateStudent() — mass-assignment fields are dropped
 *   4. schedule-exceptions getExceptionById — cross-department 403
 *   5. results.service.js getFailedStudents() — cross-school leak closed
 *   6. results.service.js submitMarks() — unregistered studentId rejected
 *   7. results.service.js getPublication() — cross-department 404
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

// ── Fixture IDs, cleaned up in `finally` ────────────────────────────────
const ids = { users: [], schools: [], departments: [], faculty: [], students: [], sessions: [], subjects: [], assignments: [], registrations: [], publications: [], exceptions: [] };

async function createUser({ schoolId, role, email, name }) {
  const user = await prisma.user.create({
    data: {
      schoolId, role, email, name,
      passwordHash: await hashPassword("Test@1234"),
      emailVerified: true,
    },
  });
  ids.users.push(user.id);
  return user;
}

async function main() {
  console.log("Setting up fixture data...");

  // ── Schools ──────────────────────────────────────────────────────────
  const schoolA = await prisma.school.create({ data: { name: `Sec Audit School A ${STAMP}`, domain: `secaudit-a-${STAMP}.edu` } });
  const schoolB = await prisma.school.create({ data: { name: `Sec Audit School B ${STAMP}`, domain: `secaudit-b-${STAMP}.edu` } });
  ids.schools.push(schoolA.id, schoolB.id);

  // ── Departments (2 in School A, 1 in School B) ──────────────────────
  const deptA1 = await prisma.department.create({ data: { schoolId: schoolA.id, name: `Dept A1 ${STAMP}` } });
  const deptA2 = await prisma.department.create({ data: { schoolId: schoolA.id, name: `Dept A2 ${STAMP}` } });
  const deptB1 = await prisma.department.create({ data: { schoolId: schoolB.id, name: `Dept B1 ${STAMP}` } });
  ids.departments.push(deptA1.id, deptA2.id, deptB1.id);

  // ── Users ────────────────────────────────────────────────────────────
  const adminA = await createUser({ schoolId: schoolA.id, role: "admin", email: `admin-a-${STAMP}@test.com`, name: "Admin A" });
  const hodA1User = await createUser({ schoolId: schoolA.id, role: "hod", email: `hod-a1-${STAMP}@test.com`, name: "HOD A1" });
  const hodA2User = await createUser({ schoolId: schoolA.id, role: "hod", email: `hod-a2-${STAMP}@test.com`, name: "HOD A2" });
  const facA1User = await createUser({ schoolId: schoolA.id, role: "faculty", email: `fac-a1-${STAMP}@test.com`, name: "Faculty A1" });
  const plainUserA = await createUser({ schoolId: schoolA.id, role: "faculty", email: `plain-a-${STAMP}@test.com`, name: "Plain User A (no Faculty row yet)" });
  const studentA1User = await createUser({ schoolId: schoolA.id, role: "student", email: `stu-a1-${STAMP}@test.com`, name: "Student A1" });
  const studentA2User = await createUser({ schoolId: schoolA.id, role: "student", email: `stu-a2-${STAMP}@test.com`, name: "Student A2 (dept A2, unregistered)" });
  const userB = await createUser({ schoolId: schoolB.id, role: "faculty", email: `user-b-${STAMP}@test.com`, name: "User B (different school)" });
  const hodB1User = await createUser({ schoolId: schoolB.id, role: "hod", email: `hod-b1-${STAMP}@test.com`, name: "HOD B1" });

  // ── Faculty rows ─────────────────────────────────────────────────────
  const hodA1Fac = await prisma.faculty.create({ data: { userId: hodA1User.id, schoolId: schoolA.id, departmentId: deptA1.id, designation: "HOD" } });
  const hodA2Fac = await prisma.faculty.create({ data: { userId: hodA2User.id, schoolId: schoolA.id, departmentId: deptA2.id, designation: "HOD" } });
  const facA1Fac = await prisma.faculty.create({ data: { userId: facA1User.id, schoolId: schoolA.id, departmentId: deptA1.id, designation: "Assistant Professor" } });
  const hodB1Fac = await prisma.faculty.create({ data: { userId: hodB1User.id, schoolId: schoolB.id, departmentId: deptB1.id, designation: "HOD" } });
  ids.faculty.push(hodA1Fac.id, hodA2Fac.id, facA1Fac.id, hodB1Fac.id);
  await prisma.department.update({ where: { id: deptA1.id }, data: { hodUserId: hodA1User.id } });
  await prisma.department.update({ where: { id: deptA2.id }, data: { hodUserId: hodA2User.id } });
  await prisma.department.update({ where: { id: deptB1.id }, data: { hodUserId: hodB1User.id } });

  // ── Student rows ─────────────────────────────────────────────────────
  const studentA1 = await prisma.student.create({
    data: { userId: studentA1User.id, schoolId: schoolA.id, departmentId: deptA1.id, rollNo: `R1-${STAMP}`, branch: "CS", batchYear: 2024, currentSemester: 3, graduationYear: 2028 },
  });
  const studentA2 = await prisma.student.create({
    data: { userId: studentA2User.id, schoolId: schoolA.id, departmentId: deptA2.id, rollNo: `R2-${STAMP}`, branch: "ME", batchYear: 2024, currentSemester: 3, graduationYear: 2028 },
  });
  ids.students.push(studentA1.id, studentA2.id);

  // ── Session + Subject + Assignment + Registration (dept A1) ─────────
  const sessionA1 = await prisma.academicSession.create({
    data: {
      schoolId: schoolA.id, departmentId: deptA1.id, name: `Sem A1 ${STAMP}`, academicYear: "2025-26",
      semesterType: "odd", startDate: new Date(), endDate: new Date(Date.now() + 30 * 86400000),
      status: "active", createdByUserId: hodA1User.id,
    },
  });
  ids.sessions.push(sessionA1.id);

  const subjectA1 = await prisma.subject.create({
    data: { schoolId: schoolA.id, departmentId: deptA1.id, name: `Subject A1 ${STAMP}`, courseCode: `CS10${STAMP % 1000}`, totalMarks: 100, passingMarks: 40 },
  });
  ids.subjects.push(subjectA1.id);

  // Semester is separate reference data results.repository.js's
  // getSemesterByNumber() looks up by (schoolId, semesterNumber) — required
  // by submitMarks() even though this test doesn't otherwise touch it.
  const semester3 = await prisma.semester.create({ data: { schoolId: schoolA.id, semesterNumber: 3, name: `Semester 3 ${STAMP}` } });
  ids.semesters = [semester3.id];

  const assignmentA1 = await prisma.facultyAssignment.create({
    data: {
      schoolId: schoolA.id, sessionId: sessionA1.id, facultyId: facA1Fac.id, subjectId: subjectA1.id,
      departmentId: deptA1.id, semesterNumber: 3, batchYear: 2024, assignedByHodId: hodA1User.id,
    },
  });
  ids.assignments.push(assignmentA1.id);

  const regA1 = await prisma.studentSessionRegistration.create({
    data: { schoolId: schoolA.id, studentId: studentA1.id, sessionId: sessionA1.id, semesterNumber: 3, batchYear: 2024 },
  });
  ids.registrations.push(regA1.id);

  // ── Result publication (dept A1) ─────────────────────────────────────
  const publicationA1 = await prisma.resultPublication.create({
    data: { schoolId: schoolA.id, sessionId: sessionA1.id, departmentId: deptA1.id, batchYear: 2024, semesterNumber: 3, status: "draft" },
  });
  ids.publications.push(publicationA1.id);

  // ── Schedule exceptions: one dept A1, one dept A2, one school-wide ──
  const exceptionA1 = await prisma.scheduleException.create({
    data: {
      schoolId: schoolA.id, sessionId: sessionA1.id, departmentId: deptA1.id, scope: "DEPARTMENT",
      startDate: new Date(), endDate: new Date(), type: "HOLIDAY", reason: "Dept A1 test holiday", declaredByUserId: hodA1User.id,
    },
  });
  const exceptionSchoolWide = await prisma.scheduleException.create({
    data: {
      schoolId: schoolA.id, sessionId: sessionA1.id, departmentId: null, scope: "SCHOOL",
      startDate: new Date(), endDate: new Date(), type: "HOLIDAY", reason: "School-wide test holiday", declaredByUserId: adminA.id,
    },
  });
  ids.exceptions.push(exceptionA1.id, exceptionSchoolWide.id);

  console.log("Fixture ready.\n");

  const tAdminA = tokenFor(adminA);
  const tHodA1 = tokenFor(hodA1User);
  const tHodA2 = tokenFor(hodA2User);
  const tFacA1 = tokenFor(facA1User);
  const tHodB1 = tokenFor(hodB1User);

  // =========================================================================
  console.log("1. auth invite() — HOD privilege escalation blocked");
  // =========================================================================
  {
    const asAdmin = await api(tAdminA, "POST", "/auth/invite", { email: `new-hod-${STAMP}@test.com`, name: "New Hod", role: "hod" });
    check("admin invites hod -> 201 (legitimate, unaffected)", asAdmin.status === 201);
    if (asAdmin.json?.data?.id) ids.users.push(asAdmin.json.data.id);

    const hodInvitesAdmin = await api(tHodA1, "POST", "/auth/invite", { email: `hacker-admin-${STAMP}@test.com`, name: "Hacker", role: "admin" });
    check("HOD invites role=admin -> blocked (400, not 201)", hodInvitesAdmin.status === 400);

    const hodInvitesHod = await api(tHodA1, "POST", "/auth/invite", { email: `hacker-hod-${STAMP}@test.com`, name: "Hacker2", role: "hod" });
    check("HOD invites role=hod -> blocked (400, not 201)", hodInvitesHod.status === 400);

    const hodInvitesFaculty = await api(tHodA1, "POST", "/auth/invite", { email: `new-fac-${STAMP}@test.com`, name: "New Faculty", role: "faculty" });
    check("HOD invites role=faculty -> 201 (legitimate, still works)", hodInvitesFaculty.status === 201);
    if (hodInvitesFaculty.json?.data?.id) ids.users.push(hodInvitesFaculty.json.data.id);

    check("invite response never contains tempPassword", asAdmin.json?.data?.tempPassword === undefined);
  }

  // =========================================================================
  console.log("\n2. faculty createFaculty() — cross-school userId rejected");
  // =========================================================================
  {
    // Module is mounted at "/faculties" (plural) — see routes/index.js.
    const crossSchool = await api(tAdminA, "POST", "/faculties", { userId: userB.id, departmentId: deptA1.id, designation: "Imported" });
    check("adminA creating faculty from School B's userId -> rejected with a real error (not 201, not a routing 404)", crossSchool.status !== 201 && crossSchool.json?.success === false);

    const legit = await api(tAdminA, "POST", "/faculties", { userId: plainUserA.id, departmentId: deptA1.id, designation: "New Faculty" });
    check("adminA creating faculty from School A's own userId -> 201 (legitimate, still works)", legit.status === 201);
    if (legit.json?.data?.id) ids.faculty.push(legit.json.data.id);
  }

  // =========================================================================
  console.log("\n3. students updateStudent() — mass assignment dropped");
  // =========================================================================
  {
    const before = await prisma.student.findUnique({ where: { id: studentA1.id } });
    await api(tAdminA, "PUT", `/students/${studentA1.id}`, {
      schoolId: schoolB.id, // attempted tenant hijack
      isPlaced: true,       // attempted unauthorized field
      branch: "Updated CS", // legitimate field
    });
    const after = await prisma.student.findUnique({ where: { id: studentA1.id } });
    check("schoolId NOT changed by request body", after.schoolId === before.schoolId && after.schoolId === schoolA.id);
    check("isPlaced NOT changed by request body", after.isPlaced === false);
    check("legitimate field (branch) DID update", after.branch === "Updated CS");
  }

  // =========================================================================
  console.log("\n4. schedule-exceptions getExceptionById — cross-department 403");
  // =========================================================================
  {
    const crossDept = await api(tHodA2, "GET", `/schedule-exceptions/${exceptionA1.id}`);
    check("HOD of dept A2 fetching dept A1's exception -> 403", crossDept.status === 403);

    const ownDept = await api(tHodA1, "GET", `/schedule-exceptions/${exceptionA1.id}`);
    check("HOD of dept A1 fetching their own exception -> 200", ownDept.status === 200);

    const schoolWide = await api(tHodA2, "GET", `/schedule-exceptions/${exceptionSchoolWide.id}`);
    check("HOD of dept A2 fetching a SCHOOL-wide exception -> 200 (still visible)", schoolWide.status === 200);
  }

  // =========================================================================
  console.log("\n5. results getFailedStudents() — cross-school leak closed");
  // =========================================================================
  {
    const crossSchool = await api(tHodB1, "GET", `/results/publications/${publicationA1.id}/failures`);
    check("HOD of School B fetching School A's publication failures -> 404 (not leaked)", crossSchool.status === 404);

    const ownSchool = await api(tHodA1, "GET", `/results/publications/${publicationA1.id}/failures`);
    check("HOD of dept A1 (owner) fetching own publication failures -> 200", ownSchool.status === 200);

    const crossDept = await api(tHodA2, "GET", `/results/publications/${publicationA1.id}/failures`);
    check("HOD of dept A2 (same school, different dept) fetching -> 404", crossDept.status === 404);
  }

  // =========================================================================
  console.log("\n6. results submitMarks() — unregistered studentId rejected");
  // =========================================================================
  {
    const badSubmit = await api(tFacA1, "POST", "/results/submit", {
      publicationId: publicationA1.id,
      subjectId: subjectA1.id,
      marks: [{ studentId: studentA2.id, marks: 80 }], // studentA2 is NOT registered for this publication
    });
    check("submitting marks for an unregistered studentId -> 400 (not written)", badSubmit.status === 400);

    const goodSubmit = await api(tFacA1, "POST", "/results/submit", {
      publicationId: publicationA1.id,
      subjectId: subjectA1.id,
      marks: [{ studentId: studentA1.id, marks: 85 }], // studentA1 IS registered
    });
    check("submitting marks for a registered studentId -> 200 (legitimate, still works)", goodSubmit.status === 200);

    const nonFinite = await api(tFacA1, "PATCH", `/results/submissions/${subjectA1.id}`, {
      publicationId: publicationA1.id,
      marks: [{ studentId: studentA1.id, marks: "not-a-number" }],
    });
    check("submitting a non-numeric mark -> 400 (not an unhandled 500)", nonFinite.status === 400);
  }

  // =========================================================================
  console.log("\n7. results getPublication() — cross-department 404");
  // =========================================================================
  {
    const crossDept = await api(tHodA2, "GET", `/results/publications/${publicationA1.id}`);
    check("HOD of dept A2 fetching dept A1's publication -> 404", crossDept.status === 404);

    const ownDept = await api(tHodA1, "GET", `/results/publications/${publicationA1.id}`);
    check("HOD of dept A1 fetching their own publication -> 200", ownDept.status === 200);

    const facultyCrossDept = await api(tFacA1, "GET", `/results/publications/${publicationA1.id}`);
    check("faculty A1 (same dept as publication) fetching -> 200 (legitimate)", facultyCrossDept.status === 200);
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
    // Children before parents, respecting FK order (relationMode="prisma" —
    // no real DB-level FKs, so this order is enforced by us, not the DB).
    await prisma.subjectMark.deleteMany({ where: { publicationId: { in: ids.publications } } }).catch(() => {});
    await prisma.facultyResultSubmission.deleteMany({ where: { publicationId: { in: ids.publications } } }).catch(() => {});
    await prisma.resultPublication.deleteMany({ where: { id: { in: ids.publications } } }).catch(() => {});
    await prisma.scheduleException.deleteMany({ where: { id: { in: ids.exceptions } } }).catch(() => {});
    await prisma.studentSessionRegistration.deleteMany({ where: { id: { in: ids.registrations } } }).catch(() => {});
    await prisma.facultyAssignment.deleteMany({ where: { id: { in: ids.assignments } } }).catch(() => {});
    await prisma.subject.deleteMany({ where: { id: { in: ids.subjects } } }).catch(() => {});
    await prisma.semester.deleteMany({ where: { id: { in: ids.semesters || [] } } }).catch(() => {});
    await prisma.academicSession.deleteMany({ where: { id: { in: ids.sessions } } }).catch(() => {});
    await prisma.student.deleteMany({ where: { id: { in: ids.students } } }).catch(() => {});
    await prisma.faculty.deleteMany({ where: { id: { in: ids.faculty } } }).catch(() => {});
    await prisma.department.updateMany({ where: { id: { in: ids.departments } }, data: { hodUserId: null } }).catch(() => {});
    await prisma.notification.deleteMany({ where: { userId: { in: ids.users } } }).catch(() => {});
    await prisma.auditLog.deleteMany({ where: { userId: { in: ids.users } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } }).catch(() => {});
    await prisma.department.deleteMany({ where: { id: { in: ids.departments } } }).catch(() => {});
    await prisma.school.deleteMany({ where: { id: { in: ids.schools } } }).catch(() => {});
    console.log("Cleanup done.");
    await prisma.$disconnect();
    process.exit(failCount > 0 ? 1 : 0);
  });
