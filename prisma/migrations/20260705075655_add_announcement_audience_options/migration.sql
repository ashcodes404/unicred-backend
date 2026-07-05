-- AlterTable
ALTER TABLE `announcements` MODIFY `scope` ENUM('school', 'department', 'hods', 'faculty', 'students') NOT NULL;
