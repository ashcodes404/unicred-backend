-- AlterTable
ALTER TABLE `schools` ADD COLUMN `gradingMethod` ENUM('absolute', 'relative') NOT NULL DEFAULT 'absolute';
