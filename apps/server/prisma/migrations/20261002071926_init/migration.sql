-- CreateTable
CREATE TABLE `User` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `openid` VARCHAR(191) NOT NULL,
    `unionid` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `nickname` VARCHAR(191) NOT NULL,
    `avatarKey` VARCHAR(191) NULL,
    `relation` ENUM('FATHER', 'MOTHER', 'SELF') NULL,
    `memberLevel` ENUM('NONE', 'TRIAL', 'PAID', 'INTENTION') NOT NULL DEFAULT 'NONE',
    `memberExpireAt` DATETIME(3) NULL,
    `inviteCode` VARCHAR(191) NOT NULL,
    `invitedByUserId` BIGINT NULL,
    `deviceFingerprint` VARCHAR(191) NULL,
    `idCardNoHash` VARCHAR(191) NULL,
    `newbieRewardClaimed` BOOLEAN NOT NULL DEFAULT false,
    `bigPayNotifyChild` BOOLEAN NOT NULL DEFAULT false,
    `cityOnlyVisible` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('ACTIVE', 'DISABLED', 'CLOSED') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_openid_key`(`openid`),
    UNIQUE INDEX `User_phone_key`(`phone`),
    UNIQUE INDEX `User_inviteCode_key`(`inviteCode`),
    UNIQUE INDEX `User_idCardNoHash_key`(`idCardNoHash`),
    INDEX `User_invitedByUserId_idx`(`invitedByUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Profile` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `matchNo` VARCHAR(191) NOT NULL,
    `ownerUserId` BIGINT NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT false,
    `relation` ENUM('FATHER', 'MOTHER', 'SELF') NOT NULL,
    `gender` ENUM('MALE', 'FEMALE') NOT NULL,
    `birthYear` INTEGER NOT NULL,
    `heightCm` INTEGER NOT NULL,
    `education` ENUM('JUNIOR_HIGH', 'HIGH_SCHOOL', 'VOCATIONAL', 'COLLEGE', 'BACHELOR', 'MASTER', 'DOCTOR') NOT NULL,
    `occupation` VARCHAR(191) NOT NULL,
    `incomeRange` ENUM('BELOW_5K', 'R5K_10K', 'R10K_20K', 'R20K_50K', 'ABOVE_50K', 'UNDISCLOSED') NOT NULL DEFAULT 'UNDISCLOSED',
    `residenceCity` VARCHAR(191) NOT NULL,
    `residenceDistrict` VARCHAR(191) NULL,
    `hometown` VARCHAR(191) NULL,
    `hukou` VARCHAR(191) NULL,
    `housing` ENUM('OWNED_FULL', 'OWNED_MORTGAGE', 'NONE', 'UNDISCLOSED') NOT NULL DEFAULT 'UNDISCLOSED',
    `car` ENUM('OWNED', 'NONE', 'UNDISCLOSED') NOT NULL DEFAULT 'UNDISCLOSED',
    `intro` TEXT NULL,
    `photos` JSON NOT NULL,
    `maritalStatus` ENUM('UNMARRIED', 'DIVORCED', 'WIDOWED', 'UNDISCLOSED') NOT NULL DEFAULT 'UNDISCLOSED',
    `maritalProofKeys` TEXT NULL,
    `isMaritalVerified` BOOLEAN NOT NULL DEFAULT false,
    `singleCommitmentSignedAt` DATETIME(3) NULL,
    `singleCommitmentIp` VARCHAR(191) NULL,
    `singleCommitmentVersion` VARCHAR(191) NULL,
    `auditStatus` ENUM('DRAFT', 'PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'DRAFT',
    `rejectReason` VARCHAR(191) NULL,
    `publishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Profile_matchNo_key`(`matchNo`),
    INDEX `Profile_ownerUserId_isActive_idx`(`ownerUserId`, `isActive`),
    INDEX `Profile_auditStatus_gender_birthYear_idx`(`auditStatus`, `gender`, `birthYear`),
    INDEX `Profile_residenceCity_idx`(`residenceCity`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Certification` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `userId` BIGINT NOT NULL,
    `profileId` BIGINT NULL,
    `type` ENUM('ID_CARD_OCR', 'FACE') NOT NULL,
    `result` ENUM('PENDING', 'PASSED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `provider` VARCHAR(191) NOT NULL,
    `verifyToken` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Certification_userId_type_result_idx`(`userId`, `type`, `result`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConsentRecord` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `profileId` BIGINT NOT NULL,
    `childPhone` VARCHAR(191) NOT NULL,
    `smsVerifiedAt` DATETIME(3) NOT NULL,
    `statementVersion` VARCHAR(191) NOT NULL,
    `ip` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ConsentRecord_profileId_idx`(`profileId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MemberQuota` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `userId` BIGINT NOT NULL,
    `orderId` BIGINT NULL,
    `source` ENUM('NEWBIE', 'INVITE', 'PAID') NOT NULL,
    `total` INTEGER NOT NULL,
    `used` INTEGER NOT NULL DEFAULT 0,
    `remaining` INTEGER NOT NULL,
    `status` ENUM('FROZEN', 'ACTIVE', 'EXPIRED') NOT NULL DEFAULT 'FROZEN',
    `expireAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MemberQuota_userId_status_expireAt_idx`(`userId`, `status`, `expireAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QuotaTxLog` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `userId` BIGINT NOT NULL,
    `quotaId` BIGINT NULL,
    `reason` ENUM('GRANT', 'DEDUCT', 'REFUND', 'EXPIRE', 'ZERO_OUT') NOT NULL,
    `change` INTEGER NOT NULL,
    `refType` VARCHAR(191) NULL,
    `refId` BIGINT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `QuotaTxLog_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UnlockRecord` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `initiatorUserId` BIGINT NOT NULL,
    `targetProfileId` BIGINT NOT NULL,
    `payType` ENUM('QUOTA', 'ONCE', 'COUPON') NOT NULL,
    `orderId` BIGINT NULL,
    `userCouponId` BIGINT NULL,
    `quotaId` BIGINT NULL,
    `status` ENUM('ACTIVE', 'EXPIRED', 'REFUNDED') NOT NULL,
    `expireAt` DATETIME(3) NOT NULL,
    `riskConfirmed` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `UnlockRecord_targetProfileId_status_idx`(`targetProfileId`, `status`),
    INDEX `UnlockRecord_expireAt_status_idx`(`expireAt`, `status`),
    UNIQUE INDEX `UnlockRecord_initiatorUserId_targetProfileId_status_key`(`initiatorUserId`, `targetProfileId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ViewRecord` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `fromUserId` BIGINT NOT NULL,
    `toProfileId` BIGINT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ViewRecord_toProfileId_updatedAt_idx`(`toProfileId`, `updatedAt`),
    UNIQUE INDEX `ViewRecord_fromUserId_toProfileId_key`(`fromUserId`, `toProfileId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FavoriteRecord` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `fromUserId` BIGINT NOT NULL,
    `toProfileId` BIGINT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `FavoriteRecord_toProfileId_createdAt_idx`(`toProfileId`, `createdAt`),
    UNIQUE INDEX `FavoriteRecord_fromUserId_toProfileId_key`(`fromUserId`, `toProfileId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FeedRotationCard` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `profileId` BIGINT NOT NULL,
    `day` DATE NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `FeedRotationCard_day_idx`(`day`),
    UNIQUE INDEX `FeedRotationCard_profileId_day_key`(`profileId`, `day`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Blacklist` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `userId` BIGINT NOT NULL,
    `blockedUserId` BIGINT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Blacklist_userId_blockedUserId_key`(`userId`, `blockedUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Conversation` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `userA` BIGINT NOT NULL,
    `userB` BIGINT NOT NULL,
    `profileA` BIGINT NOT NULL,
    `profileB` BIGINT NOT NULL,
    `unlockRecordId` BIGINT NULL,
    `imConvId` VARCHAR(191) NULL,
    `lastMsgAt` DATETIME(3) NULL,
    `lastMsgDigest` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Conversation_imConvId_key`(`imConvId`),
    INDEX `Conversation_userA_lastMsgAt_idx`(`userA`, `lastMsgAt`),
    INDEX `Conversation_userB_lastMsgAt_idx`(`userB`, `lastMsgAt`),
    UNIQUE INDEX `Conversation_userA_userB_key`(`userA`, `userB`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Message` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `convId` BIGINT NOT NULL,
    `senderUserId` BIGINT NOT NULL,
    `type` ENUM('TEXT', 'IMAGE', 'SYSTEM', 'CONTACT_CARD') NOT NULL,
    `content` TEXT NOT NULL,
    `imMsgId` VARCHAR(191) NULL,
    `readFlag` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Message_imMsgId_key`(`imMsgId`),
    INDEX `Message_convId_createdAt_idx`(`convId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ContactActionLog` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `convId` BIGINT NOT NULL,
    `actorUserId` BIGINT NOT NULL,
    `action` ENUM('EXCHANGE_WECHAT', 'CALL_PHONE', 'SEND_PHOTO') NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ContactActionLog_convId_action_idx`(`convId`, `action`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Order` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `userId` BIGINT NOT NULL,
    `type` ENUM('MEMBER', 'UNLOCK_ONCE') NOT NULL,
    `bizRef` VARCHAR(191) NULL,
    `amountCent` INTEGER NOT NULL,
    `couponDeductCent` INTEGER NOT NULL DEFAULT 0,
    `userCouponId` BIGINT NULL,
    `outTradeNo` VARCHAR(191) NOT NULL,
    `transactionId` VARCHAR(191) NULL,
    `payStatus` ENUM('CREATED', 'PAID', 'CLOSED') NOT NULL DEFAULT 'CREATED',
    `refundStatus` ENUM('NONE', 'REQUESTED', 'REFUNDING', 'REFUNDED', 'REJECTED') NOT NULL DEFAULT 'NONE',
    `refundNo` VARCHAR(191) NULL,
    `refundAmountCent` INTEGER NULL,
    `refundReason` VARCHAR(191) NULL,
    `quotaGranted` BOOLEAN NOT NULL DEFAULT false,
    `paidAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Order_outTradeNo_key`(`outTradeNo`),
    UNIQUE INDEX `Order_transactionId_key`(`transactionId`),
    INDEX `Order_userId_payStatus_idx`(`userId`, `payStatus`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CouponTemplate` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `scope` ENUM('UNLOCK', 'MEMBER') NOT NULL,
    `amountCent` INTEGER NOT NULL,
    `minAmountCent` INTEGER NOT NULL DEFAULT 0,
    `validDays` INTEGER NOT NULL,
    `startAt` DATETIME(3) NOT NULL,
    `endAt` DATETIME(3) NOT NULL,
    `stock` INTEGER NOT NULL DEFAULT 0,
    `status` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserCoupon` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `templateId` BIGINT NOT NULL,
    `userId` BIGINT NOT NULL,
    `status` ENUM('UNUSED', 'USED', 'EXPIRED') NOT NULL DEFAULT 'UNUSED',
    `expireAt` DATETIME(3) NOT NULL,
    `orderId` BIGINT NULL,
    `source` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `UserCoupon_userId_status_expireAt_idx`(`userId`, `status`, `expireAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Referral` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `inviterId` BIGINT NOT NULL,
    `inviteeId` BIGINT NOT NULL,
    `rewardStatus` ENUM('PENDING', 'REWARDED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `rewardedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Referral_inviteeId_key`(`inviteeId`),
    INDEX `Referral_inviterId_rewardStatus_idx`(`inviterId`, `rewardStatus`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Ticket` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `userId` BIGINT NOT NULL,
    `type` ENUM('FEEDBACK', 'COMPLAINT', 'REPORT', 'REFUND') NOT NULL,
    `content` TEXT NOT NULL,
    `images` JSON NULL,
    `status` ENUM('OPEN', 'PROCESSING', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `slaDeadline` DATETIME(3) NOT NULL,
    `handlerId` BIGINT NULL,
    `handlerNote` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Ticket_status_slaDeadline_idx`(`status`, `slaDeadline`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ManagerLead` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `userId` BIGINT NOT NULL,
    `city` VARCHAR(191) NOT NULL,
    `expectation` TEXT NOT NULL,
    `budgetCent` INTEGER NULL,
    `assignedManagerId` BIGINT NULL,
    `convId` VARCHAR(191) NULL,
    `status` ENUM('NEW', 'ASSIGNED', 'FOLLOWING', 'DONE') NOT NULL DEFAULT 'NEW',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ManagerLead_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NotifyPref` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `userId` BIGINT NOT NULL,
    `switches` JSON NOT NULL,
    `subscribeAuthStatus` ENUM('UNKNOWN', 'GRANTED', 'DENIED') NOT NULL DEFAULT 'UNKNOWN',
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `NotifyPref_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OpsSlot` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `type` ENUM('BANNER', 'POPUP', 'TAB_CENTER') NOT NULL,
    `content` JSON NOT NULL,
    `startAt` DATETIME(3) NOT NULL,
    `endAt` DATETIME(3) NOT NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `OpsSlot_type_enabled_startAt_endAt_idx`(`type`, `enabled`, `startAt`, `endAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RewardConfig` (
    `configKey` VARCHAR(191) NOT NULL,
    `value` JSON NOT NULL,
    `updatedBy` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`configKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminUser` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `role` ENUM('SUPER', 'REVIEWER', 'OPERATOR', 'FINANCE') NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `lastLoginAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AdminUser_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminAuditLog` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `adminUserId` BIGINT NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `targetType` VARCHAR(191) NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `ip` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AdminAuditLog_adminUserId_createdAt_idx`(`adminUserId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReconcileReport` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `day` DATE NOT NULL,
    `localCount` INTEGER NOT NULL,
    `remoteCount` INTEGER NOT NULL,
    `diffDetail` JSON NULL,
    `resolved` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ReconcileReport_day_key`(`day`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Profile` ADD CONSTRAINT `Profile_ownerUserId_fkey` FOREIGN KEY (`ownerUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Certification` ADD CONSTRAINT `Certification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConsentRecord` ADD CONSTRAINT `ConsentRecord_profileId_fkey` FOREIGN KEY (`profileId`) REFERENCES `Profile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MemberQuota` ADD CONSTRAINT `MemberQuota_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QuotaTxLog` ADD CONSTRAINT `QuotaTxLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QuotaTxLog` ADD CONSTRAINT `QuotaTxLog_quotaId_fkey` FOREIGN KEY (`quotaId`) REFERENCES `MemberQuota`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UnlockRecord` ADD CONSTRAINT `UnlockRecord_initiatorUserId_fkey` FOREIGN KEY (`initiatorUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UnlockRecord` ADD CONSTRAINT `UnlockRecord_targetProfileId_fkey` FOREIGN KEY (`targetProfileId`) REFERENCES `Profile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UnlockRecord` ADD CONSTRAINT `UnlockRecord_quotaId_fkey` FOREIGN KEY (`quotaId`) REFERENCES `MemberQuota`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ViewRecord` ADD CONSTRAINT `ViewRecord_fromUserId_fkey` FOREIGN KEY (`fromUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ViewRecord` ADD CONSTRAINT `ViewRecord_toProfileId_fkey` FOREIGN KEY (`toProfileId`) REFERENCES `Profile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FavoriteRecord` ADD CONSTRAINT `FavoriteRecord_fromUserId_fkey` FOREIGN KEY (`fromUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FavoriteRecord` ADD CONSTRAINT `FavoriteRecord_toProfileId_fkey` FOREIGN KEY (`toProfileId`) REFERENCES `Profile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeedRotationCard` ADD CONSTRAINT `FeedRotationCard_profileId_fkey` FOREIGN KEY (`profileId`) REFERENCES `Profile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Blacklist` ADD CONSTRAINT `Blacklist_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Blacklist` ADD CONSTRAINT `Blacklist_blockedUserId_fkey` FOREIGN KEY (`blockedUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Conversation` ADD CONSTRAINT `Conversation_userA_fkey` FOREIGN KEY (`userA`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Conversation` ADD CONSTRAINT `Conversation_userB_fkey` FOREIGN KEY (`userB`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Conversation` ADD CONSTRAINT `Conversation_profileA_fkey` FOREIGN KEY (`profileA`) REFERENCES `Profile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Conversation` ADD CONSTRAINT `Conversation_profileB_fkey` FOREIGN KEY (`profileB`) REFERENCES `Profile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Conversation` ADD CONSTRAINT `Conversation_unlockRecordId_fkey` FOREIGN KEY (`unlockRecordId`) REFERENCES `UnlockRecord`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_convId_fkey` FOREIGN KEY (`convId`) REFERENCES `Conversation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ContactActionLog` ADD CONSTRAINT `ContactActionLog_convId_fkey` FOREIGN KEY (`convId`) REFERENCES `Conversation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserCoupon` ADD CONSTRAINT `UserCoupon_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `CouponTemplate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserCoupon` ADD CONSTRAINT `UserCoupon_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Referral` ADD CONSTRAINT `Referral_inviterId_fkey` FOREIGN KEY (`inviterId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Referral` ADD CONSTRAINT `Referral_inviteeId_fkey` FOREIGN KEY (`inviteeId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ticket` ADD CONSTRAINT `Ticket_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ManagerLead` ADD CONSTRAINT `ManagerLead_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NotifyPref` ADD CONSTRAINT `NotifyPref_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
