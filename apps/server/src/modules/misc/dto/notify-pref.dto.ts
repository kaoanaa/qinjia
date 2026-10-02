import { IsIn, IsObject, IsOptional } from 'class-validator';

/**
 * 通知设置更新（契约 PUT /api/v1/settings/notify）。switches 允许任意布尔键：
 * 契约键 review/expireRemind/activity/rewardArrived + 内部键 im（离线补达开关，Step 10 已用）。
 * 值必须为布尔 —— class-validator each 不覆盖对象值，由 MiscService.assertSwitchValues 裁决。
 */
export class UpdateNotifyPrefDto {
  @IsOptional()
  @IsObject()
  switches?: Record<string, boolean>;

  @IsOptional()
  @IsIn(['UNKNOWN', 'GRANTED', 'DENIED'])
  subscribeAuthStatus?: string;
}
