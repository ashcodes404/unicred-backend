-- CreateTable
CREATE TABLE `schedule_exceptions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `schoolId` INTEGER NOT NULL,
    `sessionId` INTEGER NOT NULL,
    `departmentId` INTEGER NULL,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NOT NULL,
    `type` ENUM('HOLIDAY', 'HALF_DAY') NOT NULL,
    `scope` ENUM('SCHOOL', 'DEPARTMENT') NOT NULL,
    `startTime` VARCHAR(191) NULL,
    `endTime` VARCHAR(191) NULL,
    `reason` VARCHAR(191) NOT NULL,
    `declaredByUserId` INTEGER NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `schedule_exceptions_departmentId_idx`(`departmentId`),
    INDEX `schedule_exceptions_schoolId_idx`(`schoolId`),
    INDEX `schedule_exceptions_sessionId_idx`(`sessionId`),
    INDEX `schedule_exceptions_schoolId_startDate_endDate_idx`(`schoolId`, `startDate`, `endDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `faculty_absences` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `schoolId` INTEGER NOT NULL,
    `sessionId` INTEGER NOT NULL,
    `facultyId` INTEGER NOT NULL,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NOT NULL,
    `reason` TEXT NOT NULL,
    `status` ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
    `hodComment` VARCHAR(191) NULL,
    `reviewedByHodId` INTEGER NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `faculty_absences_schoolId_idx`(`schoolId`),
    INDEX `faculty_absences_facultyId_idx`(`facultyId`),
    INDEX `faculty_absences_sessionId_idx`(`sessionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `absence_substitutions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `schoolId` INTEGER NOT NULL,
    `absenceId` INTEGER NOT NULL,
    `timetableSlotId` INTEGER NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `substituteFacultyId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `absence_substitutions_schoolId_idx`(`schoolId`),
    INDEX `absence_substitutions_absenceId_idx`(`absenceId`),
    INDEX `absence_substitutions_timetableSlotId_idx`(`timetableSlotId`),
    INDEX `absence_substitutions_substituteFacultyId_idx`(`substituteFacultyId`),
    UNIQUE INDEX `absence_substitutions_absenceId_timetableSlotId_date_key`(`absenceId`, `timetableSlotId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
