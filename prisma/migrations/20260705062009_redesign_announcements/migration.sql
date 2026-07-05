/*
  Warnings:

  - You are about to drop the column `facultyId` on the `announcements` table. All the data in the column will be lost.
  - Added the required column `schoolId` to the `announcements` table without a default value. This is not possible if the table is not empty.
  - Added the required column `scope` to the `announcements` table without a default value. This is not possible if the table is not empty.
  - Added the required column `senderUserId` to the `announcements` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX `announcements_facultyId_fkey` ON `announcements`;

-- AlterTable
ALTER TABLE `announcements` DROP COLUMN `facultyId`,
    ADD COLUMN `schoolId` INTEGER NOT NULL,
    ADD COLUMN `scope` ENUM('school', 'department', 'students') NOT NULL,
    ADD COLUMN `senderUserId` INTEGER NOT NULL,
    ADD COLUMN `sessionId` INTEGER NULL,
    MODIFY `departmentId` INTEGER NULL;

-- CreateTable
CREATE TABLE `announcement_recipients` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `announcementId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `announcement_recipients_announcementId_idx`(`announcementId`),
    INDEX `announcement_recipients_userId_idx`(`userId`),
    UNIQUE INDEX `announcement_recipients_announcementId_userId_key`(`announcementId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `announcements_schoolId_idx` ON `announcements`(`schoolId`);

-- CreateIndex
CREATE INDEX `announcements_senderUserId_idx` ON `announcements`(`senderUserId`);

-- CreateIndex
CREATE INDEX `announcements_sessionId_idx` ON `announcements`(`sessionId`);
