/**
 * MANUAL TEST SCRIPT — Announcements feature
 * =========================================================================
 * This repo has no Jest/Mocha suite (see package.json), so this is a
 * Postman-collection-style script instead: it builds a small, throwaway
 * set of schools/departments/users/students directly with Prisma, mints
 * JWTs for them with signAccessToken() (skipping login entirely — we don't
 * care about passwords here, only about announcement behaviour), then
 * drives the REAL running API with plain fetch() calls and checks the
 * responses.
 *
 * Run with the backend dev server already running (npm run dev), then:
 *   node scripts/test-announcements.js
 *
 * Everything this script creates is deleted again in the `finally` block
 * at the bottom, whether the checks pass or fail — the database is left
 * exactly as it was found.
 *
 * SCENARIOS COVERED:
 *   1. Admin creates a SCHOOL-wide announcement  -> every HOD/Faculty/Student
 *      of that school can see it; a different school's users cannot.
 *   2. HOD creates a DEPARTMENT announcement     -> only that department's
 *      Faculty/Students see it; a sibling department cannot.
 *   3. Faculty creates a STUDENTS announcement   -> only the specific
 *      students registered under their active FacultyAssignment see it;
 *      an unrelated student in the same department does not.
 *   4. A student is blocked (403) from creating any announcement.
 *   5. Cross-school access to an announcement by id is blocked (404, not
 *      just a permission error — see announcement.repository.js's
 *      findByIdForUser() for why 404 is the deliberate choice).
 */

const prisma = require("../src/config/db");
const { signAccessToken } = require("../src/utils/jwt");

const BASE_URL = "http://localhost:5000/api";
const STAMP = Date.now(); // makes every unique field (emails, domains, roll numbers) collision-free across runs

// ── Tiny assertion helper ────────────────────────────────────────────────
// Keeps every check to one readable line: a label, and whether it passed.
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

// ── Tiny authenticated-fetch helper ──────────────────────────────────────
// Wraps fetch() so every call site just passes a token + method/body,
// instead of repeating the same headers everywhere.
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

// Mints a token the same shape auth.middleware.js expects (userId, role, schoolId).
function tokenFor(user) {
  return signAccessToken({ userId: user.id, role: user.role, schoolId: user.schoolId });
}

// Does announcement id `announcementId` appear anywhere in this user's
// GET /api/announcements list? Used instead of re-checking every field by
// hand for every scenario below.
async function canSeeInList(token, announcementId) {
  const { json } = await api(token, "GET", "/announcements?limit=100");
  const rows = json?.data?.announcements ?? [];
  return rows.some((a) => a.id === announcementId);
}

async function main() {
  // ── 1. Build the fixture ────────────────────────────────────────────
  console.log("Setting up fixture data...");

  const schoolA = await prisma.school.create({ data: { name: "Test School A", domain: `test-a-${STAMP}.edu` } });
  const schoolB = await prisma.school.create({ data: { name: "Test School B", domain: `test-b-${STAMP}.edu` } });

  const deptA1 = await prisma.department.create({ data: { schoolId: schoolA.id, name: `Dept A1 ${STAMP}` } });
  const deptA2 = await prisma.department.create({ data: { schoolId: schoolA.id, name: `Dept A2 ${STAMP}` } });
  const deptB1 = await prisma.department.create({ data: { schoolId: schoolB.id, name: `Dept B1 ${STAMP}` } });

  // Placeholder — never used to log in (we mint JWTs directly), just satisfies the NOT NULL column.
  const passwordHash = "test-fixture-not-a-real-hash";

  async function makeUser(schoolId, role, label) {
    return prisma.user.create({
      data: { schoolId, role, name: `${label} ${STAMP}`, email: `${label.toLowerCase()}-${STAMP}@test.local`, passwordHash },
    });
  }

  const adminA = await makeUser(schoolA.id, "admin", "AdminA");
  const hodA1User = await makeUser(schoolA.id, "hod", "HodA1");
  const facA1User = await makeUser(schoolA.id, "faculty", "FacA1");
  const facA1bUser = await makeUser(schoolA.id, "faculty", "FacA1b");
  const hodA2User = await makeUser(schoolA.id, "hod", "HodA2");
  const facA2User = await makeUser(schoolA.id, "faculty", "FacA2");
  const studentXUser = await makeUser(schoolA.id, "student", "StudentX"); // taught by facA1
  const studentYUser = await makeUser(schoolA.id, "student", "StudentY"); // same dept, NOT taught by facA1
  const studentA2User = await makeUser(schoolA.id, "student", "StudentA2"); // different department

  const adminB = await makeUser(schoolB.id, "admin", "AdminB");
  const hodBUser = await makeUser(schoolB.id, "hod", "HodB");
  const facBUser = await makeUser(schoolB.id, "faculty", "FacB");
  const studentBUser = await makeUser(schoolB.id, "student", "StudentB");

  async function makeFaculty(user, departmentId) {
    return prisma.faculty.create({ data: { userId: user.id, schoolId: user.schoolId, departmentId, designation: "Lecturer" } });
  }
  const hodA1Faculty = await makeFaculty(hodA1User, deptA1.id);
  const facA1Faculty = await makeFaculty(facA1User, deptA1.id);
  await makeFaculty(facA1bUser, deptA1.id);
  const hodA2Faculty = await makeFaculty(hodA2User, deptA2.id);
  await makeFaculty(facA2User, deptA2.id);
  const hodBFaculty = await makeFaculty(hodBUser, deptB1.id);
  await makeFaculty(facBUser, deptB1.id);

  async function makeStudent(user, departmentId, rollNo) {
    return prisma.student.create({
      data: {
        userId: user.id, schoolId: user.schoolId, departmentId, rollNo, branch: "CS",
        batchYear: 2024, currentSemester: 3, graduationYear: 2028,
      },
    });
  }
  const studentX = await makeStudent(studentXUser, deptA1.id, `RX-${STAMP}`);
  await makeStudent(studentYUser, deptA1.id, `RY-${STAMP}`);
  await makeStudent(studentA2User, deptA2.id, `RA2-${STAMP}`);
  await makeStudent(studentBUser, deptB1.id, `RB-${STAMP}`);

  // Now that the HOD users exist, point each department at its HOD.
  await prisma.department.update({ where: { id: deptA1.id }, data: { hodUserId: hodA1User.id } });
  await prisma.department.update({ where: { id: deptA2.id }, data: { hodUserId: hodA2User.id } });
  await prisma.department.update({ where: { id: deptB1.id }, data: { hodUserId: hodBUser.id } });

  // An ACTIVE session for Dept A1 — required for the "faculty -> their
  // current students" scope, which only looks at the active session.
  const session = await prisma.academicSession.create({
    data: {
      schoolId: schoolA.id, departmentId: deptA1.id, name: `Session ${STAMP}`,
      academicYear: "2025-26", semesterType: "odd",
      startDate: new Date(), endDate: new Date(Date.now() + 90 * 86400000),
      status: "active", createdByUserId: hodA1User.id,
    },
  });

  const subject = await prisma.subject.create({
    data: { schoolId: schoolA.id, departmentId: deptA1.id, name: `Subject ${STAMP}`, courseCode: `CS${STAMP}` },
  });

  // facA1 is assigned to teach batch 2024 / semester 3 this session.
  await prisma.facultyAssignment.create({
    data: {
      schoolId: schoolA.id, sessionId: session.id, facultyId: facA1Faculty.id, subjectId: subject.id,
      departmentId: deptA1.id, semesterNumber: 3, batchYear: 2024, assignedByHodId: hodA1Faculty.id,
    },
  });

  // Only studentX is registered under that exact batch/semester this
  // session — studentY deliberately has NO registration, so they must NOT
  // end up in facA1's "current students" announcement.
  await prisma.studentSessionRegistration.create({
    data: { schoolId: schoolA.id, studentId: studentX.id, sessionId: session.id, semesterNumber: 3, batchYear: 2024 },
  });

  const tAdminA = tokenFor(adminA);
  const tHodA1 = tokenFor(hodA1User);
  const tFacA1 = tokenFor(facA1User);
  const tHodA2 = tokenFor(hodA2User);
  const tFacA2 = tokenFor(facA2User);
  const tStudentX = tokenFor(studentXUser);
  const tStudentY = tokenFor(studentYUser);
  const tStudentA2 = tokenFor(studentA2User);
  const tAdminB = tokenFor(adminB);
  const tHodB = tokenFor(hodBUser);
  const tFacB = tokenFor(facBUser);
  const tStudentB = tokenFor(studentBUser);

  console.log("Fixture ready.\n");

  // ── 2. Scenario 1: admin -> whole school ─────────────────────────────
  console.log("Scenario 1: admin creates a SCHOOL-wide announcement");
  const schoolWide = await api(tAdminA, "POST", "/announcements", {
    title: "School-wide notice", content: "Everyone please read this.", audienceType: "school",
  });
  check("create succeeded (201)", schoolWide.status === 201);
  const schoolWideId = schoolWide.json?.data?.id;

  check("HOD A1 (same school) sees it", await canSeeInList(tHodA1, schoolWideId));
  check("HOD A2 (same school) sees it", await canSeeInList(tHodA2, schoolWideId));
  check("Faculty A1 (same school) sees it", await canSeeInList(tFacA1, schoolWideId));
  check("Student X (same school) sees it", await canSeeInList(tStudentX, schoolWideId));
  check("Student Y (same school) sees it", await canSeeInList(tStudentY, schoolWideId));

  // Requirement #4: a real Notification row, not just AnnouncementRecipient
  // visibility — check a sample of the actual audience directly in the DB.
  const notifiedCount = await prisma.notification.count({
    where: { userId: { in: [hodA1User.id, facA1User.id, studentXUser.id] }, type: "ANNOUNCEMENT_POSTED" },
  });
  check("Notification rows exist for the school-wide audience", notifiedCount === 3);
  check("Admin B (different school) does NOT see it", !(await canSeeInList(tAdminB, schoolWideId)));
  check("HOD B (different school) does NOT see it", !(await canSeeInList(tHodB, schoolWideId)));
  check("Student B (different school) does NOT see it", !(await canSeeInList(tStudentB, schoolWideId)));

  // ── 3. Scenario 2: HOD -> own department only ────────────────────────
  console.log("\nScenario 2: HOD creates a DEPARTMENT announcement");
  const deptWide = await api(tHodA1, "POST", "/announcements", {
    title: "Dept A1 notice", content: "For our department only.", audienceType: "department",
  });
  check("create succeeded (201)", deptWide.status === 201);
  const deptWideId = deptWide.json?.data?.id;

  check("Faculty A1 (same dept) sees it", await canSeeInList(tFacA1, deptWideId));
  check("Student X (same dept) sees it", await canSeeInList(tStudentX, deptWideId));
  check("Student Y (same dept) sees it", await canSeeInList(tStudentY, deptWideId));
  check("HOD A2 (sibling dept, same school) does NOT see it", !(await canSeeInList(tHodA2, deptWideId)));
  check("Faculty A2 (sibling dept) does NOT see it", !(await canSeeInList(tFacA2, deptWideId)));
  check("Student in Dept A2 does NOT see it", !(await canSeeInList(tStudentA2, deptWideId)));
  check("HOD B (different school) does NOT see it", !(await canSeeInList(tHodB, deptWideId)));

  // ── 4. Scenario 3: faculty -> only students they currently teach ─────
  console.log("\nScenario 3: faculty creates a STUDENTS announcement");
  const studentsOnly = await api(tFacA1, "POST", "/announcements", {
    title: "For my class", content: "Assignment due Friday.",
  });
  check("create succeeded (201)", studentsOnly.status === 201);
  const studentsOnlyId = studentsOnly.json?.data?.id;

  check("Student X (registered, taught by facA1) sees it", await canSeeInList(tStudentX, studentsOnlyId));
  check("Student Y (same dept, NOT registered this batch/sem) does NOT see it", !(await canSeeInList(tStudentY, studentsOnlyId)));
  check("HOD A1 (not a recipient of this one) does NOT see it in received list", !(await canSeeInList(tHodA1, studentsOnlyId)));

  // ── 5. Unauthorized creation ──────────────────────────────────────────
  console.log("\nScenario 4: student cannot create an announcement");
  const blocked = await api(tStudentX, "POST", "/announcements", { title: "x", content: "y" });
  check("student create is blocked (403)", blocked.status === 403);

  // ── 6. Cross-school detail access ─────────────────────────────────────
  console.log("\nScenario 5: cross-school detail access is blocked");
  const crossSchool = await api(tAdminB, "GET", `/announcements/${schoolWideId}`);
  check("School B admin cannot fetch School A's announcement (404)", crossSchool.status === 404);

  // ── Summary ────────────────────────────────────────────────────────────
  console.log(`\n${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exitCode = 1;

  // Return every id we created so `finally` below can clean it all up.
  return {
    schoolIds: [schoolA.id, schoolB.id],
  };
}

main()
  .catch((err) => {
    console.error("Test script crashed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Cleanup — deletes cascade from School down through everything this
    // script created (Department/User/Faculty/Student/etc. all carry
    // schoolId, and Prisma's relationMode="prisma" + onDelete: Cascade on
    // the models that declare it handles the rest). Wrapped in try/catch so
    // a cleanup hiccup never hides the real pass/fail result printed above.
    console.log("\nCleaning up fixture data...");
    try {
      const schools = await prisma.school.findMany({
        where: { domain: { contains: `-${STAMP}.edu` } },
        select: { id: true },
      });
      const schoolIds = schools.map((s) => s.id);
      if (schoolIds.length) {
        // Delete in dependency order — children before parents — since this
        // DB's relationMode="prisma" means there are no real DB-level
        // cascading foreign keys to rely on for most of these tables.
        await prisma.announcementRecipient.deleteMany({ where: { announcement: { schoolId: { in: schoolIds } } } });
        await prisma.announcement.deleteMany({ where: { schoolId: { in: schoolIds } } });
        await prisma.studentSessionRegistration.deleteMany({ where: { schoolId: { in: schoolIds } } });
        await prisma.facultyAssignment.deleteMany({ where: { schoolId: { in: schoolIds } } });
        await prisma.subject.deleteMany({ where: { schoolId: { in: schoolIds } } });
        await prisma.academicSession.deleteMany({ where: { schoolId: { in: schoolIds } } });
        await prisma.student.deleteMany({ where: { schoolId: { in: schoolIds } } });
        await prisma.faculty.deleteMany({ where: { schoolId: { in: schoolIds } } });
        // Departments reference their HOD's User — null that out before
        // deleting Users, otherwise the (Prisma-emulated) FK would complain.
        await prisma.department.updateMany({ where: { schoolId: { in: schoolIds } }, data: { hodUserId: null } });
        await prisma.user.deleteMany({ where: { schoolId: { in: schoolIds } } });
        await prisma.department.deleteMany({ where: { schoolId: { in: schoolIds } } });
        await prisma.school.deleteMany({ where: { id: { in: schoolIds } } });
      }
      console.log("Cleanup done.");
    } catch (cleanupErr) {
      console.error("Cleanup failed — you may need to remove test rows manually:", cleanupErr.message);
    } finally {
      await prisma.$disconnect();
    }
  });
