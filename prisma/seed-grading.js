// prisma/seed-grading.js
// Run once after migration: node prisma/seed-grading.js
// Creates the global default 10-point grading scale.
// Schools that don't customize will fall back to this.

const prisma = require("../src/config/db");

async function main() {
  console.log("Seeding default grading system...");

  // schoolId = null means this is the global default (not tied to any school)
  const existing = await prisma.gradingSystem.findFirst({
    where: { isDefault: true, schoolId: null },
  });

  if (existing) {
    console.log("Default grading system already exists. Skipping.");
    return;
  }

  await prisma.gradingSystem.create({
    data: {
      schoolId: null,
      name: "Default 10-Point Grading Scale",
      isDefault: true,
      isActive: true,
      rules: {
        create: [
          { grade: "O",  gradePoint: 10, minMarksPercent: 90,   maxMarksPercent: 100   },
          { grade: "A+", gradePoint: 9,  minMarksPercent: 80,   maxMarksPercent: 89.99 },
          { grade: "A",  gradePoint: 8,  minMarksPercent: 70,   maxMarksPercent: 79.99 },
          { grade: "B+", gradePoint: 7,  minMarksPercent: 60,   maxMarksPercent: 69.99 },
          { grade: "B",  gradePoint: 6,  minMarksPercent: 50,   maxMarksPercent: 59.99 },
          { grade: "C",  gradePoint: 5,  minMarksPercent: 40,   maxMarksPercent: 49.99 },
          { grade: "F",  gradePoint: 0,  minMarksPercent: 0,    maxMarksPercent: 39.99 },
        ],
      },
    },
  });

  console.log("✅ Default grading system seeded.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
