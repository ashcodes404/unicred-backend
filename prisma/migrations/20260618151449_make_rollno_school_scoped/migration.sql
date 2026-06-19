/*
  Warnings:

  - A unique constraint covering the columns `[schoolId,rollNo]` on the table `students` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX `students_rollNo_key` ON `students`;

-- CreateIndex
CREATE UNIQUE INDEX `students_schoolId_rollNo_key` ON `students`(`schoolId`, `rollNo`);
