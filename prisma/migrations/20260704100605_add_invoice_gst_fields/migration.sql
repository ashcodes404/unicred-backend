-- AlterTable
ALTER TABLE `invoices` ADD COLUMN `baseAmount` DOUBLE NULL,
    ADD COLUMN `cgstAmount` DOUBLE NULL,
    ADD COLUMN `gstRate` DOUBLE NULL,
    ADD COLUMN `sellerGstin` VARCHAR(191) NULL,
    ADD COLUMN `sgstAmount` DOUBLE NULL;
