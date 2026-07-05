-- AlterTable
ALTER TABLE `schools` ADD COLUMN `queuedPaymentId` INTEGER NULL,
    ADD COLUMN `queuedPlan` VARCHAR(191) NULL,
    ADD COLUMN `queuedPlanDurationMonths` INTEGER NULL,
    ADD COLUMN `queuedPlanStartsAt` DATETIME(3) NULL;
