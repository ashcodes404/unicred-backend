-- Timetable documents: split by audience (faculty/student) and allow multiple
-- documents per department. Existing single documents are backfilled to the
-- `student` audience.

-- 1. Add the audience column. A temporary default backfills existing rows;
--    the default is dropped afterwards so the schema has no DB-level default.
ALTER TABLE `department_timetables`
    ADD COLUMN `audience` ENUM('faculty', 'student') NOT NULL DEFAULT 'student';

ALTER TABLE `department_timetables`
    ALTER COLUMN `audience` DROP DEFAULT;

-- 2. Optional per-document title/label.
ALTER TABLE `department_timetables`
    ADD COLUMN `title` VARCHAR(191) NULL;

-- 3. Drop the one-per-department uniqueness so multiple documents are allowed.
DROP INDEX `department_timetables_departmentId_key` ON `department_timetables`;

-- 4. Index lookups by department + audience (faculty vs student views).
CREATE INDEX `department_timetables_departmentId_audience_idx`
    ON `department_timetables`(`departmentId`, `audience`);
