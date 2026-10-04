import { IsBoolean, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class AdminLoginDto {
  @IsString() @IsNotEmpty() @MaxLength(64)
  username!: string;

  @IsString() @IsNotEmpty() @MaxLength(128)
  password!: string;
}

export class AuditDecisionDto {
  @IsIn(['APPROVE', 'REJECT'])
  decision!: string;

  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;

  /** 婚姻证明选审结论（D5）：仅 APPROVE 时有意义 */
  @IsOptional() @IsIn(['PASS', 'FAIL'])
  maritalVerified?: 'PASS' | 'FAIL';
}

export class CertReviewDto {
  @IsIn(['CONFIRM', 'REVOKE'])
  decision!: string;

  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}

export class ConfigUpdateDto {
  @IsObject()
  value!: Record<string, unknown>;
}

export class OpsSlotUpsertDto {
  @IsOptional() @Matches(/^\d{1,19}$/, { message: 'id 非法' })
  id?: string;

  @IsIn(['BANNER', 'POPUP', 'TAB_CENTER'])
  type!: string;

  @IsObject()
  content!: Record<string, unknown>;

  @IsString()
  startAt!: string;

  @IsString()
  endAt!: string;

  @IsOptional()
  sort?: number;

  @IsOptional() @IsIn(['true', 'false'])
  enabled?: string;
}

export class RefundDecisionDto {
  @IsBoolean()
  approved!: boolean;

  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}

export class ManagerLeadAssignDto {
  @Matches(/^\d{1,19}$/, { message: 'managerId 非法' })
  managerId!: string;
}

export class TicketUpdateDto {
  @IsOptional() @IsIn(['OPEN', 'PROCESSING', 'CLOSED'])
  status?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  handlerNote?: string;
}
