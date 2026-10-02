import { IsInt, IsOptional, Min } from 'class-validator';

export class SendPhotoDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  photoIndex?: number;
}
