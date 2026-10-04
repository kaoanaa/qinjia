-- CreateIndex
CREATE INDEX `ManagerLead_status_createdAt_idx` ON `ManagerLead`(`status`, `createdAt`);

-- AddForeignKey
ALTER TABLE `ManagerLead` ADD CONSTRAINT `ManagerLead_assignedManagerId_fkey` FOREIGN KEY (`assignedManagerId`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
