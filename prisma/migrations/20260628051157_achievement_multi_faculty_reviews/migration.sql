-- CreateTable
CREATE TABLE `achievement_reviews` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `achievementId` INTEGER NOT NULL,
    `facultyId` INTEGER NOT NULL,
    `status` ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
    `remark` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `achievement_reviews_achievementId_idx`(`achievementId`),
    INDEX `achievement_reviews_facultyId_idx`(`facultyId`),
    UNIQUE INDEX `achievement_reviews_achievementId_facultyId_key`(`achievementId`, `facultyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
