import { IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** 工单提交（契约 POST /api/v1/tickets；REFUND 关联订单） */
export class CreateTicketDto {
  @IsIn(['FEEDBACK', 'COMPLAINT', 'REPORT', 'REFUND'])
  type!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content!: string;

  @IsOptional()
  @IsString({ each: true })
  images?: string[];

  @IsOptional()
  @Matches(/^\d{1,19}$/, { message: 'orderId 非法' })
  orderId?: string;
}
