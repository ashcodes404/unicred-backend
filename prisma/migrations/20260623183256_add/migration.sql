/*
  Warnings:

  - You are about to drop the column `code` on the `subjects` table. All the data in the column will be lost.
  - You are about to drop the `resume_templates` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `resumes` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[tokenHash]` on the table `refresh_tokens` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[departmentId,courseCode]` on the table `subjects` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `publicationId` to the `subject_marks` table without a default value. This is not possible if the table is not empty.
  - Added the required column `courseCode` to the `subjects` table without a default value. This is not possible if the table is not empty.
  - Added the required column `departmentId` to the `subjects` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE `achievements` DROP FOREIGN KEY `achievements_studentId_fkey`;

-- DropForeignKey
ALTER TABLE `achievements` DROP FOREIGN KEY `achievements_verifiedBy_fkey`;

-- DropForeignKey
ALTER TABLE `announcements` DROP FOREIGN KEY `announcements_departmentId_fkey`;

-- DropForeignKey
ALTER TABLE `announcements` DROP FOREIGN KEY `announcements_facultyId_fkey`;

-- DropForeignKey
ALTER TABLE `audit_logs` DROP FOREIGN KEY `audit_logs_userId_fkey`;

-- DropForeignKey
ALTER TABLE `cgpa_records` DROP FOREIGN KEY `cgpa_records_semesterId_fkey`;

-- DropForeignKey
ALTER TABLE `cgpa_records` DROP FOREIGN KEY `cgpa_records_studentId_fkey`;

-- DropForeignKey
ALTER TABLE `departments` DROP FOREIGN KEY `departments_hodUserId_fkey`;

-- DropForeignKey
ALTER TABLE `departments` DROP FOREIGN KEY `departments_schoolId_fkey`;

-- DropForeignKey
ALTER TABLE `faculty` DROP FOREIGN KEY `faculty_departmentId_fkey`;

-- DropForeignKey
ALTER TABLE `faculty` DROP FOREIGN KEY `faculty_schoolId_fkey`;

-- DropForeignKey
ALTER TABLE `faculty` DROP FOREIGN KEY `faculty_userId_fkey`;

-- DropForeignKey
ALTER TABLE `internships` DROP FOREIGN KEY `internships_achievementId_fkey`;

-- DropForeignKey
ALTER TABLE `internships` DROP FOREIGN KEY `internships_studentId_fkey`;

-- DropForeignKey
ALTER TABLE `notifications` DROP FOREIGN KEY `notifications_userId_fkey`;

-- DropForeignKey
ALTER TABLE `otp_verifications` DROP FOREIGN KEY `otp_verifications_userId_fkey`;

-- DropForeignKey
ALTER TABLE `placements` DROP FOREIGN KEY `placements_studentId_fkey`;

-- DropForeignKey
ALTER TABLE `projects` DROP FOREIGN KEY `projects_studentId_fkey`;

-- DropForeignKey
ALTER TABLE `refresh_tokens` DROP FOREIGN KEY `refresh_tokens_userId_fkey`;

-- DropForeignKey
ALTER TABLE `resumes` DROP FOREIGN KEY `resumes_studentId_fkey`;

-- DropForeignKey
ALTER TABLE `resumes` DROP FOREIGN KEY `resumes_templateId_fkey`;

-- DropForeignKey
ALTER TABLE `semesters` DROP FOREIGN KEY `semesters_schoolId_fkey`;

-- DropForeignKey
ALTER TABLE `skills` DROP FOREIGN KEY `skills_studentId_fkey`;

-- DropForeignKey
ALTER TABLE `students` DROP FOREIGN KEY `students_departmentId_fkey`;

-- DropForeignKey
ALTER TABLE `students` DROP FOREIGN KEY `students_schoolId_fkey`;

-- DropForeignKey
ALTER TABLE `students` DROP FOREIGN KEY `students_userId_fkey`;

-- DropForeignKey
ALTER TABLE `subject_marks` DROP FOREIGN KEY `subject_marks_semesterId_fkey`;

-- DropForeignKey
ALTER TABLE `subject_marks` DROP FOREIGN KEY `subject_marks_studentId_fkey`;

-- DropForeignKey
ALTER TABLE `subject_marks` DROP FOREIGN KEY `subject_marks_subjectId_fkey`;

-- DropForeignKey
ALTER TABLE `subjects` DROP FOREIGN KEY `subjects_schoolId_fkey`;

-- DropForeignKey
ALTER TABLE `users` DROP FOREIGN KEY `users_schoolId_fkey`;

-- DropIndex
DROP INDEX `subjects_schoolId_code_key` ON `subjects`;

-- AlterTable
ALTER TABLE `achievements` ADD COLUMN `sessionId` INTEGER NULL;

-- AlterTable
ALTER TABLE `announcements` MODIFY `content` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `faculty` ADD COLUMN `officeLocation` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `subject_marks` ADD COLUMN `invalidatedAt` DATETIME(3) NULL,
    ADD COLUMN `isReappear` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `publicationId` INTEGER NOT NULL;

-- AlterTable
ALTER TABLE `subjects` DROP COLUMN `code`,
    ADD COLUMN `courseCode` VARCHAR(191) NOT NULL,
    ADD COLUMN `credits` INTEGER NOT NULL DEFAULT 3,
    ADD COLUMN `departmentId` INTEGER NOT NULL,
    ADD COLUMN `isActive` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `passingMarks` DOUBLE NOT NULL DEFAULT 40,
    ADD COLUMN `subjectType` ENUM('theory', 'lab', 'tutorial') NOT NULL DEFAULT 'theory',
    ADD COLUMN `totalMarks` DOUBLE NOT NULL DEFAULT 100;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `failedLoginAttempts` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `lockedUntil` DATETIME(3) NULL;

-- DropTable
DROP TABLE `resume_templates`;

-- DropTable
DROP TABLE `resumes`;

-- CreateTable
CREATE TABLE `academic_sessions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `schoolId` INTEGER NOT NULL,
    `departmentId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `academicYear` VARCHAR(191) NOT NULL,
    `semesterType` ENUM('odd', 'even') NOT NULL,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NOT NULL,
    `status` ENUM('upcoming', 'active', 'completed', 'archived') NOT NULL DEFAULT 'upcoming',
    `createdByUserId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `academic_sessions_schoolId_departmentId_idx`(`schoolId`, `departmentId`),
    INDEX `academic_sessions_schoolId_status_idx`(`schoolId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `course_offerings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `schoolId` INTEGER NOT NULL,
    `sessionId` INTEGER NOT NULL,
    `subjectId` INTEGER NOT NULL,
    `departmentId` INTEGER NOT NULL,
    `semesterNumber` INTEGER NOT NULL,
    `batchYear` INTEGER NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `course_offerings_schoolId_idx`(`schoolId`),
    INDEX `course_offerings_sessionId_idx`(`sessionId`),
    INDEX `course_offerings_subjectId_idx`(`subjectId`),
    UNIQUE INDEX `course_offerings_sessionId_subjectId_batchYear_key`(`sessionId`, `subjectId`, `batchYear`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `faculty_assignments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `schoolId` INTEGER NOT NULL,
    `sessionId` INTEGER NOT NULL,
    `facultyId` INTEGER NOT NULL,
    `subjectId` INTEGER NOT NULL,
    `departmentId` INTEGER NOT NULL,
    `semesterNumber` INTEGER NOT NULL,
    `batchYear` INTEGER NOT NULL,
    `assignedByHodId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `faculty_assignments_schoolId_idx`(`schoolId`),
    INDEX `faculty_assignments_facultyId_idx`(`facultyId`),
    INDEX `faculty_assignments_sessionId_idx`(`sessionId`),
    UNIQUE INDEX `faculty_assignments_sessionId_facultyId_subjectId_batchYear_key`(`sessionId`, `facultyId`, `subjectId`, `batchYear`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_session_registrations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `schoolId` INTEGER NOT NULL,
    `studentId` INTEGER NOT NULL,
    `sessionId` INTEGER NOT NULL,
    `semesterNumber` INTEGER NOT NULL,
    `batchYear` INTEGER NOT NULL,
    `status` ENUM('active', 'completed', 'detained') NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `student_session_registrations_schoolId_idx`(`schoolId`),
    INDEX `student_session_registrations_studentId_idx`(`studentId`),
    INDEX `student_session_registrations_sessionId_idx`(`sessionId`),
    UNIQUE INDEX `student_session_registrations_studentId_sessionId_key`(`studentId`, `sessionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `syllabi` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `schoolId` INTEGER NOT NULL,
    `subjectId` INTEGER NOT NULL,
    `content` LONGTEXT NOT NULL,
    `learningOutcomes` TEXT NULL,
    `syllabusUrl` VARCHAR(191) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `uploadedByHodId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `facultyId` INTEGER NULL,

    UNIQUE INDEX `syllabi_subjectId_key`(`subjectId`),
    INDEX `syllabi_schoolId_idx`(`schoolId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `result_publications` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `schoolId` INTEGER NOT NULL,
    `sessionId` INTEGER NOT NULL,
    `departmentId` INTEGER NOT NULL,
    `batchYear` INTEGER NOT NULL,
    `semesterNumber` INTEGER NOT NULL,
    `status` ENUM('draft', 'under_review', 'frozen', 'published') NOT NULL DEFAULT 'draft',
    `publishedByHodId` INTEGER NULL,
    `publishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `result_publications_schoolId_idx`(`schoolId`),
    INDEX `result_publications_sessionId_idx`(`sessionId`),
    UNIQUE INDEX `result_publications_sessionId_departmentId_batchYear_semeste_key`(`sessionId`, `departmentId`, `batchYear`, `semesterNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `faculty_result_submissions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `schoolId` INTEGER NOT NULL,
    `publicationId` INTEGER NOT NULL,
    `facultyId` INTEGER NOT NULL,
    `subjectId` INTEGER NOT NULL,
    `isSubmitted` BOOLEAN NOT NULL DEFAULT false,
    `submittedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `faculty_result_submissions_schoolId_idx`(`schoolId`),
    INDEX `faculty_result_submissions_publicationId_idx`(`publicationId`),
    UNIQUE INDEX `faculty_result_submissions_publicationId_subjectId_key`(`publicationId`, `subjectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reappear_applications` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `schoolId` INTEGER NOT NULL,
    `studentId` INTEGER NOT NULL,
    `subjectId` INTEGER NOT NULL,
    `sessionId` INTEGER NOT NULL,
    `semesterNumber` INTEGER NOT NULL,
    `reason` TEXT NOT NULL,
    `status` ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
    `hodComment` VARCHAR(191) NULL,
    `reviewedByHodId` INTEGER NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `reappear_applications_schoolId_idx`(`schoolId`),
    INDEX `reappear_applications_studentId_idx`(`studentId`),
    INDEX `reappear_applications_sessionId_idx`(`sessionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `timetables` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `schoolId` INTEGER NOT NULL,
    `sessionId` INTEGER NOT NULL,
    `departmentId` INTEGER NOT NULL,
    `batchYear` INTEGER NOT NULL,
    `semesterNumber` INTEGER NOT NULL,
    `status` ENUM('draft', 'submitted', 'returned', 'approved') NOT NULL DEFAULT 'draft',
    `submittedAt` DATETIME(3) NULL,
    `approvedAt` DATETIME(3) NULL,
    `adminComment` VARCHAR(191) NULL,
    `reviewedByAdminId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `timetables_schoolId_idx`(`schoolId`),
    INDEX `timetables_sessionId_idx`(`sessionId`),
    UNIQUE INDEX `timetables_sessionId_departmentId_batchYear_semesterNumber_key`(`sessionId`, `departmentId`, `batchYear`, `semesterNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `timetable_slots` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `schoolId` INTEGER NOT NULL,
    `timetableId` INTEGER NOT NULL,
    `subjectId` INTEGER NOT NULL,
    `facultyId` INTEGER NOT NULL,
    `dayOfWeek` INTEGER NOT NULL,
    `startTime` VARCHAR(191) NOT NULL,
    `endTime` VARCHAR(191) NOT NULL,
    `classroom` VARCHAR(191) NOT NULL,
    `slotType` ENUM('lecture', 'lab', 'tutorial') NOT NULL DEFAULT 'lecture',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `timetable_slots_schoolId_idx`(`schoolId`),
    INDEX `timetable_slots_timetableId_idx`(`timetableId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `schoolId` INTEGER NOT NULL,
    `studentId` INTEGER NOT NULL,
    `subjectId` INTEGER NOT NULL,
    `sessionId` INTEGER NOT NULL,
    `facultyId` INTEGER NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `status` ENUM('present', 'absent', 'late', 'excused') NOT NULL,
    `markedByFacultyId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `attendance_schoolId_idx`(`schoolId`),
    INDEX `attendance_studentId_idx`(`studentId`),
    INDEX `attendance_subjectId_sessionId_idx`(`subjectId`, `sessionId`),
    UNIQUE INDEX `attendance_studentId_subjectId_sessionId_date_key`(`studentId`, `subjectId`, `sessionId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `internal_assessments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `schoolId` INTEGER NOT NULL,
    `studentId` INTEGER NOT NULL,
    `subjectId` INTEGER NOT NULL,
    `sessionId` INTEGER NOT NULL,
    `facultyId` INTEGER NOT NULL,
    `assessmentType` ENUM('quiz', 'assignment', 'midterm', 'lab', 'viva', 'practical') NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `marks` DOUBLE NOT NULL,
    `maxMarks` DOUBLE NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `internal_assessments_schoolId_idx`(`schoolId`),
    INDEX `internal_assessments_studentId_idx`(`studentId`),
    INDEX `internal_assessments_subjectId_sessionId_idx`(`subjectId`, `sessionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `achievements_sessionId_idx` ON `achievements`(`sessionId`);

-- CreateIndex
CREATE INDEX `notifications_userId_isRead_idx` ON `notifications`(`userId`, `isRead`);

-- CreateIndex
CREATE UNIQUE INDEX `refresh_tokens_tokenHash_key` ON `refresh_tokens`(`tokenHash`);

-- CreateIndex
CREATE INDEX `subject_marks_publicationId_idx` ON `subject_marks`(`publicationId`);

-- CreateIndex
CREATE INDEX `subjects_schoolId_idx` ON `subjects`(`schoolId`);

-- CreateIndex
CREATE INDEX `subjects_departmentId_idx` ON `subjects`(`departmentId`);

-- CreateIndex
CREATE UNIQUE INDEX `subjects_departmentId_courseCode_key` ON `subjects`(`departmentId`, `courseCode`);
