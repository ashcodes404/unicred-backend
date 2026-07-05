/**
 * MANUAL TEST SCRIPT — Announcement "Announce to" audience picker
 * =========================================================================
 * Same Postman-collection-style approach as scripts/test-announcements.js
 * (no Jest suite in this repo): builds a small throwaway fixture with
 * Prisma, mints JWTs directly, drives the REAL running API, and checks
 * exactly who ends up as a recipient (+ gets a Notification row) for every
 * audienceType option admin and HOD can pick.
 *
 * Run with the backend dev server already running (npm run dev), then:
 *   node scripts/test-announcement-audience.js
 *
 * Everything created here is deleted again in the `finally` block, pass or fail.
 */

const prisma = require("../src/config/db");
const { signAccessToken } = require("../src/utils/jwt");

const BASE_URL = "http://localhost:5000/api";
const STAMP = Date.now();

let passCount = 0;
let failCount = 0;
function check(label, condition) {
  if (condition) { passCount++; console.log(`  PASS  ${label}`); }
  else { failCount++; console.log(`  FAIL  ${label}`); }
}

async function api(token, method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

function tokenFor(user) {
  return signAccessToken({ userId: user.id, role: user.role, schoolId: user.schoolId });
}

// Was this user actually notified (ANNOUNCEMENT_POSTED) for this exact announcement?
// Checked directly against the DB rather than the API, since Notification
// has no per-announcement id to filter by via the API — this is the ground truth.
async function wasNotified(userId, announcementId) {
  const link = new RegExp(`/${announcementId}$`);
  const rows = await prisma.notification.findMany({ where: { userId, type: "ANNOUNCEMENT_POSTED" } });
  return rows.some((r) => link.test(r.link || ""));
}

async function isRecipient(userId, announcementId) {
  const row = await prisma.announcementRecipient.findUnique({
    where: { announcementId_userId: { announcementId, userId } },
  });
  return !!row;
}

async function main() {
  console.log("Setting up fixture data...");

  const school = await prisma.school.create({ data: { name: "Audience Test School", domain: `test-aud-${STAMP}.edu` } });
  const dept1 = await prisma.department.create({ data: { schoolId: school.id, name: `Dept1 ${STAMP}` } });
  const dept2 = await prisma.department.create({ data: { schoolId: school.id, name: `Dept2 ${STAMP}` } });

  const passwordHash = "test-fixture-not-a-real-hash";
  async function makeUser(role, label) {
    return prisma.user.create({
      data: { schoolId: school.id, role, name: `${label} ${STAMP}`, email: `${label.toLowerCase()}-${STAMP}@test.local`, passwordHash },
    });
  }
  async function makeFaculty(user, departmentId) {
    return prisma.faculty.create({ data: { userId: user.id, schoolId: school.id, departmentId, designation: "Lecturer" } });
  }
  async function makeStudent(user, departmentId, rollNo) {
    return prisma.student.create({
      data: { userId: user.id, schoolId: school.id, departmentId, rollNo, branch: "CS", batchYear: 2024, currentSemester: 3, graduationYear: 2028 },
    });
  }

  const admin = await makeUser("admin", "Admin");

  const hod1User = await makeUser("hod", "Hod1");
  const hod2User = await makeUser("hod", "Hod2");
  const fac1User = await makeUser("faculty", "Fac1");
  const fac2User = await makeUser("faculty", "Fac2");
  const stu1User = await makeUser("student", "Stu1");
  const stu2User = await makeUser("student", "Stu2");

  await makeFaculty(hod1User, dept1.id);
  await makeFaculty(fac1User, dept1.id);
  await makeFaculty(hod2User, dept2.id);
  await makeFaculty(fac2User, dept2.id);
  await makeStudent(stu1User, dept1.id, `S1-${STAMP}`);
  await makeStudent(stu2User, dept2.id, `S2-${STAMP}`);

  await prisma.department.update({ where: { id: dept1.id }, data: { hodUserId: hod1User.id } });
  await prisma.department.update({ where: { id: dept2.id }, data: { hodUserId: hod2User.id } });

  const tAdmin = tokenFor(admin);
  const tHod1 = tokenFor(hod1User);

  console.log("Fixture ready.\n");

  // ── Admin: audienceType = "school" ───────────────────────────────────
  console.log('Admin -> "Entire School"');
  const r1 = await api(tAdmin, "POST", "/announcements", { title: "A-school", content: "x", audienceType: "school" });
  check("create succeeded (201)", r1.status === 201);
  const id1 = r1.json?.data?.id;
  check("HOD1 is a recipient", await isRecipient(hod1User.id, id1));
  check("HOD1 was notified", await wasNotified(hod1User.id, id1));
  check("Faculty1 is a recipient", await isRecipient(fac1User.id, id1));
  check("Student1 is a recipient", await isRecipient(stu1User.id, id1));
  check("Student2 (dept2) is a recipient too (whole school)", await isRecipient(stu2User.id, id1));

  // ── Admin: audienceType = "hods" ──────────────────────────────────────
  console.log('\nAdmin -> "All HODs"');
  const r2 = await api(tAdmin, "POST", "/announcements", { title: "A-hods", content: "x", audienceType: "hods" });
  check("create succeeded (201)", r2.status === 201);
  const id2 = r2.json?.data?.id;
  check("HOD1 is a recipient", await isRecipient(hod1User.id, id2));
  check("HOD2 is a recipient", await isRecipient(hod2User.id, id2));
  check("Faculty1 is NOT a recipient", !(await isRecipient(fac1User.id, id2)));
  check("Student1 is NOT a recipient", !(await isRecipient(stu1User.id, id2)));

  // ── Admin: audienceType = "faculty" ───────────────────────────────────
  console.log('\nAdmin -> "All Faculty"');
  const r3 = await api(tAdmin, "POST", "/announcements", { title: "A-faculty", content: "x", audienceType: "faculty" });
  check("create succeeded (201)", r3.status === 201);
  const id3 = r3.json?.data?.id;
  check("Faculty1 is a recipient", await isRecipient(fac1User.id, id3));
  check("Faculty2 (dept2) is a recipient", await isRecipient(fac2User.id, id3));
  check("HOD1 is NOT a recipient", !(await isRecipient(hod1User.id, id3)));
  check("Student1 is NOT a recipient", !(await isRecipient(stu1User.id, id3)));

  // ── Admin: audienceType = "students" ──────────────────────────────────
  console.log('\nAdmin -> "All Students"');
  const r4 = await api(tAdmin, "POST", "/announcements", { title: "A-students", content: "x", audienceType: "students" });
  check("create succeeded (201)", r4.status === 201);
  const id4 = r4.json?.data?.id;
  check("Student1 is a recipient", await isRecipient(stu1User.id, id4));
  check("Student2 (dept2) is a recipient", await isRecipient(stu2User.id, id4));
  check("HOD1 is NOT a recipient", !(await isRecipient(hod1User.id, id4)));
  check("Faculty1 is NOT a recipient", !(await isRecipient(fac1User.id, id4)));

  // ── HOD1: audienceType = "department" ─────────────────────────────────
  console.log('\nHOD1 -> "Entire Department"');
  const r5 = await api(tHod1, "POST", "/announcements", { title: "H-dept", content: "x", audienceType: "department" });
  check("create succeeded (201)", r5.status === 201);
  const id5 = r5.json?.data?.id;
  check("Faculty1 (dept1) is a recipient", await isRecipient(fac1User.id, id5));
  check("Student1 (dept1) is a recipient", await isRecipient(stu1User.id, id5));
  check("Faculty2 (dept2) is NOT a recipient", !(await isRecipient(fac2User.id, id5)));
  check("Student2 (dept2) is NOT a recipient", !(await isRecipient(stu2User.id, id5)));

  // ── HOD1: audienceType = "faculty" ────────────────────────────────────
  console.log('\nHOD1 -> "Faculty (my dept)"');
  const r6 = await api(tHod1, "POST", "/announcements", { title: "H-faculty", content: "x", audienceType: "faculty" });
  check("create succeeded (201)", r6.status === 201);
  const id6 = r6.json?.data?.id;
  check("Faculty1 (dept1) is a recipient", await isRecipient(fac1User.id, id6));
  check("Faculty1 was notified", await wasNotified(fac1User.id, id6));
  check("Student1 (dept1) is NOT a recipient", !(await isRecipient(stu1User.id, id6)));

  // ── HOD1: audienceType = "students" ───────────────────────────────────
  console.log('\nHOD1 -> "Students (my dept)"');
  const r7 = await api(tHod1, "POST", "/announcements", { title: "H-students", content: "x", audienceType: "students" });
  check("create succeeded (201)", r7.status === 201);
  const id7 = r7.json?.data?.id;
  check("Student1 (dept1) is a recipient", await isRecipient(stu1User.id, id7));
  check("Student1 was notified", await wasNotified(stu1User.id, id7));
  check("Faculty1 (dept1) is NOT a recipient", !(await isRecipient(fac1User.id, id7)));

  // ── Validation: missing/invalid audienceType is rejected ──────────────
  console.log("\nValidation");
  const bad1 = await api(tAdmin, "POST", "/announcements", { title: "no-audience", content: "x" });
  check("admin: missing audienceType -> 400", bad1.status === 400);
  const bad2 = await api(tAdmin, "POST", "/announcements", { title: "bad-audience", content: "x", audienceType: "department" });
  check('admin: "department" (a HOD-only value) -> 400', bad2.status === 400);
  const bad3 = await api(tHod1, "POST", "/announcements", { title: "bad-audience", content: "x", audienceType: "school" });
  check('HOD: "school" (an admin-only value) -> 400', bad3.status === 400);

  console.log(`\n${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exitCode = 1;
}

main()
  .catch((err) => { console.error("Test script crashed:", err); process.exitCode = 1; })
  .finally(async () => {
    console.log("\nCleaning up fixture data...");
    try {
      const schools = await prisma.school.findMany({ where: { domain: { contains: `-${STAMP}.edu` } }, select: { id: true } });
      const schoolIds = schools.map((s) => s.id);
      if (schoolIds.length) {
        await prisma.announcementRecipient.deleteMany({ where: { announcement: { schoolId: { in: schoolIds } } } });
        await prisma.announcement.deleteMany({ where: { schoolId: { in: schoolIds } } });
        await prisma.student.deleteMany({ where: { schoolId: { in: schoolIds } } });
        await prisma.faculty.deleteMany({ where: { schoolId: { in: schoolIds } } });
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
