const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.$transaction([

    prisma.subjectMark.deleteMany(),
    prisma.cgpaRecord.deleteMany(),

    prisma.skill.deleteMany(),
    prisma.project.deleteMany(),
    prisma.achievement.deleteMany(),
    prisma.internship.deleteMany(),
    prisma.placement.deleteMany(),

    prisma.resume.deleteMany(),
    prisma.resumeTemplate.deleteMany(),

    prisma.notification.deleteMany(),
    prisma.announcement.deleteMany(),

    prisma.refreshToken.deleteMany(),
    prisma.auditLog.deleteMany(),

    prisma.student.deleteMany(),
    prisma.faculty.deleteMany(),

    prisma.subject.deleteMany(),
    prisma.semester.deleteMany(),
    prisma.department.deleteMany(),

    prisma.user.deleteMany(),
    prisma.school.deleteMany(),
  ]);

  console.log("Database cleared successfully");
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });