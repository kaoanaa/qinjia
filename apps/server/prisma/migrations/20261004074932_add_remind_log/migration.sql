-- CreateTable
CREATE TABLE `RemindLog` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `userId` BIGINT NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `memberExpireAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `RemindLog_userId_kind_memberExpireAt_key`(`userId`, `kind`, `memberExpireAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
