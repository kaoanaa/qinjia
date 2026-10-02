import { IsBoolean, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class ConsentSendSmsDto {
  @IsString() @Matches(/^\d+$/)
  profileId!: string;

  @IsString() @Matches(/^1\d{10}$/)
  childPhone!: string;
}

export class ConsentVerifyDto {
  @IsString() @Matches(/^\d+$/)
  profileId!: string;

  /** 与 send-sms 同一手机号（真实短信服务按 phone+scene 校验验证码归属） */
  @IsString() @Matches(/^1\d{10}$/)
  childPhone!: string;

  @IsString() @IsNotEmpty() @MaxLength(10)
  code!: string;

  /** 授权声明本次勾选，服务端不可绕过（I5/PIPL） */
  @IsBoolean()
  statementAccepted!: boolean;

  @IsString() @MaxLength(20)
  statementVersion!: string;
}
