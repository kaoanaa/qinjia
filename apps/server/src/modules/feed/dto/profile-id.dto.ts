import { IsString, Matches } from 'class-validator';

export class ProfileIdDto {
  @IsString()
  @Matches(/^\d{1,19}$/, { message: 'profileId 非法' })
  profileId!: string;
}
