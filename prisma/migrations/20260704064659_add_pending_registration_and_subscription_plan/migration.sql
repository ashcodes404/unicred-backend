-- CreateTable
CREATE TABLE `pending_registrations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tempId` VARCHAR(191) NOT NULL,
    `schoolData` JSON NOT NULL,
    `adminData` JSON NULL,
    `selectedPlan` VARCHAR(191) NOT NULL,
    `planAmount` DOUBLE NOT NULL,
    `status` ENUM('school_pending', 'admin_pending', 'ready') NOT NULL DEFAULT 'school_pending',
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `pending_registrations_tempId_key`(`tempId`),
    INDEX `pending_registrations_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscription_plans` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `durationMonths` INTEGER NOT NULL,
    `price` DOUBLE NOT NULL,
    `isCustom` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `subscription_plans_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
