import { Relation, Gender, Education, IncomeRange, HousingStatus, CarStatus, MaritalStatus } from '@prisma/client';
import {
  IsArray, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, ArrayMaxSize,
} from 'class-validator';

export class UpsertProfileDto {
  @IsEnum(Relation)
  relation!: Relation;

  @IsEnum(Gender)
  gender!: Gender;

  @IsInt() @Min(1900) @Max(2020)
  birthYear!: number;

  @IsInt() @Min(100) @Max(250)
  heightCm!: number;

  @IsEnum(Education)
  education!: Education;

  @IsString() @MaxLength(40)
  occupation!: string;

  @IsEnum(IncomeRange) @IsOptional()
  incomeRange?: IncomeRange;

  @IsString() @MaxLength(30)
  residenceCity!: string;

  @IsString() @MaxLength(30) @IsOptional()
  residenceDistrict?: string;

  @IsString() @MaxLength(30) @IsOptional()
  hometown?: string;

  @IsString() @MaxLength(30) @IsOptional()
  hukou?: string;

  @IsEnum(HousingStatus) @IsOptional()
  housing?: HousingStatus;

  @IsEnum(CarStatus) @IsOptional()
  car?: CarStatus;

  @IsString() @MaxLength(500) @IsOptional()
  intro?: string;

  @IsString() @MaxLength(10) @IsOptional()
  bodyType?: string;

  /** 择偶标准（结构化可空） */
  @IsInt() @Min(100) @Max(250) @IsOptional()
  expectHeightMin?: number;

  @IsInt() @Min(100) @Max(250) @IsOptional()
  expectHeightMax?: number;

  @IsInt() @Min(1900) @Max(2020) @IsOptional()
  expectBirthYearMin?: number;

  @IsInt() @Min(1900) @Max(2020) @IsOptional()
  expectBirthYearMax?: number;

  @IsEnum(Education) @IsOptional()
  expectEducation?: Education;

  @IsString() @MaxLength(30) @IsOptional()
  expectCity?: string;

  /** 私有桶 objectKey（先走 /media/upload-token 直传） */
  @IsArray() @IsString({ each: true }) @ArrayMaxSize(9) @IsOptional()
  photoObjectKeys?: string[];

  @IsEnum(MaritalStatus) @IsOptional()
  maritalStatus?: MaritalStatus;
}
