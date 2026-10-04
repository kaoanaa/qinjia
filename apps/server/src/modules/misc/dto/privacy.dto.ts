import { IsBoolean, IsOptional } from 'class-validator';

export class UpdatePrivacyDto {
  @IsOptional()
  @IsBoolean()
  cityOnlyVisible?: boolean;

  @IsOptional()
  @IsBoolean()
  bigPayNotifyChild?: boolean;
}
