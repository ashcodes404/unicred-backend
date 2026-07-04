-- AlterTable
ALTER TABLE `payments` ADD COLUMN `planId` INTEGER NULL,
    ADD COLUMN `purpose` ENUM('registration', 'renewal') NOT NULL DEFAULT 'registration',
    ADD COLUMN `schoolId` INTEGER NULL,
    MODIFY `tempId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `payments_schoolId_idx` ON `payments`(`schoolId`);
