import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';

export class MaritalProofDto {
  /** 私有桶 marital_proof objectKey（先走 /media/upload-token 直传，D5） */
  @IsArray() @IsString({ each: true }) @ArrayMinSize(1) @ArrayMaxSize(9)
  objectKeys!: string[];
}
