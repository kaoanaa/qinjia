import { IsIn, IsOptional, Matches } from 'class-validator';

export class CreateOrderDto {
  @IsIn(['MEMBER', 'UNLOCK_ONCE'], { message: 'type 仅支持 MEMBER | UNLOCK_ONCE' })
  type!: string;

  @IsOptional()
  @Matches(/^[a-z0-9_-]+$/i, { message: 'planId 非法' })
  planId?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'targetProfileId 必须为数字字符串' })
  targetProfileId?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'userCouponId 必须为数字字符串' })
  userCouponId?: string;
}
