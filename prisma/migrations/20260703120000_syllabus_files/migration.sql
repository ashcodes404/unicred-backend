-- CreateTable
CREATE TABLE `syllabus_files` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `schoolId` INTEGER NOT NULL,
    `departmentId` INTEGER NOT NULL,
    `subjectId` INTEGER NOT NULL,
    `fileUrl` TEXT NOT NULL,
    `title` VARCHAR(191) NULL,
    `uploadedById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `syllabus_files_schoolId_idx`(`schoolId`),
    INDEX `syllabus_files_departmentId_idx`(`departmentId`),
    INDEX `syllabus_files_subjectId_idx`(`subjectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
