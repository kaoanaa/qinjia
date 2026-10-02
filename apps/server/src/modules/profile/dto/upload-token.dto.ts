import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UploadTokenDto {
  @IsIn(['photos', 'marital_proof', 'id_card'])
  bucket!: 'photos' | 'marital_proof' | 'id_card';

  @IsString() @MaxLength(60) @IsOptional()
  mime?: string;
}
