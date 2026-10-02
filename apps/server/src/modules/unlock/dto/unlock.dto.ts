import { IsBoolean, IsOptional, Matches } from 'class-validator';

export class UnlockCheckDto {
  @Matches(/^\d+$/, { message: 'profileId 必须为数字字符串' })
  profileId!: string;
}

export class UnlockDto {
  @Matches(/^\d+$/, { message: 'profileId 必须为数字字符串' })
  profileId!: string;

  /** 未核验档案二次确认（§6.3 用例 13）：缺省 false */
  @IsOptional()
  @IsBoolean()
  riskConfirmed?: boolean;

  /** 券抵扣（P1 接入券模板；此处按契约预留） */
  @IsOptional()
  @Matches(/^\d+$/, { message: 'userCouponId 必须为数字字符串' })
  userCouponId?: string;
}
