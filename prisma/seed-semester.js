// scripts/seed-semesters.js
const prisma = require("../src/config/db");

async function main() {
  const schoolId = 90001; // your school ID

  const semesters = [1,2,3,4,5,6,7,8].map((num) => ({
    schoolId,
    semesterNumber: num,
    name: `Semester ${num}`,
  }));

  await prisma.semester.createMany({
    data: semesters,
    skipDuplicates: true,
  });

  console.log("✅ Semesters seeded");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());