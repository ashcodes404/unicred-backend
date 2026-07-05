const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  await prisma.$transaction([
    // Child tables first

    prisma.subjectMark.deleteMany(),
    prisma.cgpaRecord.deleteMany(),

    prisma.achievementReview.deleteMany(),

    prisma.internalAssessment.deleteMany(),
    prisma.attendance.deleteMany(),

    prisma.facultyResultSubmission.deleteMany(),
    prisma.resultPublication.deleteMany(),

    prisma.reappearApplication.deleteMany(),
    prisma.studentSessionRegistration.deleteMany(),

    prisma.facultyAssignment.deleteMany(),
    prisma.courseOffering.deleteMany(),

    prisma.timetableSlot.deleteMany(),
    prisma.timetable.deleteMany(),

    prisma.syllabus.deleteMany(),

    prisma.gradeRule.deleteMany(),
    prisma.gradingSystem.deleteMany(),

    prisma.skill.deleteMany(),
    prisma.project.deleteMany(),
    prisma.achievement.deleteMany(),
    prisma.internship.deleteMany(),
    prisma.placement.deleteMany(),

    prisma.notification.deleteMany(),
    prisma.announcement.deleteMany(),

    prisma.refreshToken.deleteMany(),
    prisma.otpVerification.deleteMany(),
    prisma.auditLog.deleteMany(),

    // Parent tables

    prisma.student.deleteMany(),
    prisma.faculty.deleteMany(),

    prisma.subject.deleteMany(),
    prisma.semester.deleteMany(),
    prisma.academicSession.deleteMany(),
    prisma.department.deleteMany(),

    prisma.user.deleteMany(),

    prisma.school.deleteMany(),
  ]);

  console.log("✅ Database cleared successfully.");
}

main()
  .catch((err) => {
    console.error("❌ Error clearing database:");
    console.error(err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });