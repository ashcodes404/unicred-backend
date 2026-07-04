-- CreateTable
CREATE TABLE `subscription_reminders` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `schoolId` INTEGER NOT NULL,
    `reminderType` ENUM('DAYS_7', 'DAYS_3', 'DAYS_1', 'EXPIRED') NOT NULL,
    `subscriptionExpiryDate` DATETIME(3) NOT NULL,
    `sentAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `subscription_reminders_schoolId_idx`(`schoolId`),
    UNIQUE INDEX `subscription_reminders_schoolId_reminderType_subscriptionExp_key`(`schoolId`, `reminderType`, `subscriptionExpiryDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
