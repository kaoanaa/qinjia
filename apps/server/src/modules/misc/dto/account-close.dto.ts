import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class AccountCloseDto {
  @IsBoolean()
  confirmed!: boolean;

  @IsOptional()
  @IsString()
  smsCode?: string;
}
