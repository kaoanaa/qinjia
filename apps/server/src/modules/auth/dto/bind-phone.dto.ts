import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class BindPhoneDto {
  /** getPhoneNumber 动态令牌 */
  @IsString() @IsNotEmpty() @MaxLength(128)
  phoneCode!: string;
}
