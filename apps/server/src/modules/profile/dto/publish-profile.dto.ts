import { IsBoolean, IsString, MaxLength } from 'class-validator';

export class PublishProfileDto {
  /** 本次是否勾选单身承诺书；false → 403 COMMITMENT_REQUIRED（用例 5，红线 I4） */
  @IsBoolean()
  commitmentChecked!: boolean;

  /** 声明版本号（留痕，禁止前端拼接文案，红线 I1） */
  @IsString() @MaxLength(20)
  commitmentVersion!: string;
}
