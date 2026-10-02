import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class IdCardOcrDto {
  /** 私有桶 id_card objectKey（先走 /media/upload-token 直传，原文不落库 I5） */
  @IsString() @IsNotEmpty() @MaxLength(200)
  objectKey!: string;
}

export class FaceInitDto {
  @IsString() @Matches(/^\d+$/) @IsOptional()
  certId?: string;
}

export class FaceVerifyDto {
  @IsString() @IsNotEmpty()
  sessionId!: string;
}
