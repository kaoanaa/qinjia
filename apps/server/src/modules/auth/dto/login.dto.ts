import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsString() @IsNotEmpty() @MaxLength(128)
  code!: string;

  /** 防刷三唯一之一（§6.6），客户端采集 */
  @IsString() @IsOptional() @MaxLength(128)
  deviceFingerprint?: string;

  /** 带参邀请（D10，发奖在 Step 6/15 实名通过时触发，此处仅登记关系） */
  @IsString() @IsOptional() @MaxLength(16)
  inviteCode?: string;
}
