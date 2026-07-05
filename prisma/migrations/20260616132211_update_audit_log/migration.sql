/*
  Warnings:

  - You are about to drop the column `entityId` on the `audit_logs` table. All the data in the column will be lost.
  - You are about to drop the column `entityType` on the `audit_logs` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE `audit_logs` DROP FOREIGN KEY `audit_logs_userId_fkey`;

-- AlterTable
ALTER TABLE `audit_logs` DROP COLUMN `entityId`,
    DROP COLUMN `entityType`,
    ADD COLUMN `ipAddress` VARCHAR(191) NULL,
    ADD COLUMN `schoolId` INTEGER NULL,
    ADD COLUMN `userAgent` VARCHAR(191) NULL,
    MODIFY `userId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `audit_logs_schoolId_idx` ON `audit_logs`(`schoolId`);

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
