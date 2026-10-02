import { IsString, Matches } from 'class-validator';

export class SwitchActiveDto {
  @IsString() @Matches(/^\d+$/)
  profileId!: string;
}
