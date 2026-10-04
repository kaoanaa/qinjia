-- AlterTable
ALTER TABLE `SystemNotification` MODIFY `category` ENUM('audit', 'expire', 'activity', 'reward', 'risk', 'greet') NOT NULL;
