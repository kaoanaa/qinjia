import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateManagerLeadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  city!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  expectation!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  budgetCent?: number;
}
