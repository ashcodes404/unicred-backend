-- AlterTable
ALTER TABLE `cgpa_records` ADD COLUMN `sgpa` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `totalCredits` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `subject_marks` ADD COLUMN `grade` VARCHAR(191) NULL,
    ADD COLUMN `gradePoint` DOUBLE NULL,
    ADD COLUMN `gradingSystemId` INTEGER NULL;

-- CreateTable
CREATE TABLE `grading_systems` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `schoolId` INTEGER NULL,
    `name` VARCHAR(191) NOT NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `grading_systems_schoolId_idx`(`schoolId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `grade_rules` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `gradingSystemId` INTEGER NOT NULL,
    `grade` VARCHAR(191) NOT NULL,
    `gradePoint` DOUBLE NOT NULL,
    `minMarksPercent` DOUBLE NOT NULL,
    `maxMarksPercent` DOUBLE NOT NULL,

    INDEX `grade_rules_gradingSystemId_idx`(`gradingSystemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
