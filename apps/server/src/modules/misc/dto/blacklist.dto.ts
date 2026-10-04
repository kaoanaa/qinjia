import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class AddBlacklistDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+$/, { message: 'blockedUserId 必须是数字字符串' })
  blockedUserId!: string;
}
