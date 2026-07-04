-- AlterTable
ALTER TABLE `pending_registrations` MODIFY `status` ENUM('school_pending', 'admin_pending', 'ready', 'completed') NOT NULL DEFAULT 'school_pending';

-- AlterTable
ALTER TABLE `schools` ADD COLUMN `address` VARCHAR(191) NULL,
    ADD COLUMN `city` VARCHAR(191) NULL,
    ADD COLUMN `code` VARCHAR(191) NULL,
    ADD COLUMN `country` VARCHAR(191) NULL,
    ADD COLUMN `paymentStatus` ENUM('PENDING', 'PAID', 'FAILED') NULL DEFAULT 'PENDING',
    ADD COLUMN `pincode` VARCHAR(191) NULL,
    ADD COLUMN `plan` VARCHAR(191) NULL,
    ADD COLUMN `planDurationMonths` INTEGER NULL,
    ADD COLUMN `razorpayOrderId` VARCHAR(191) NULL,
    ADD COLUMN `razorpayPaymentId` VARCHAR(191) NULL,
    ADD COLUMN `state` VARCHAR(191) NULL,
    ADD COLUMN `subscriptionExpiryDate` DATETIME(3) NULL,
    ADD COLUMN `subscriptionStartDate` DATETIME(3) NULL,
    ADD COLUMN `subscriptionStatus` ENUM('PENDING', 'ACTIVE', 'EXPIRED', 'CANCELLED') NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX `schools_subscriptionExpiryDate_idx` ON `schools`(`subscriptionExpiryDate`);
