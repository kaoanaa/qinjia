/*
  Warnings:

  - A unique constraint covering the columns `[sessionId]` on the table `Certification` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `Certification` ADD COLUMN `detail` JSON NULL,
    ADD COLUMN `sessionId` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Certification_sessionId_key` ON `Certification`(`sessionId`);
