import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/** 配合 JwtAuthGuard 使用：注入 req.userId（BigInt） */
export const CurrentUserId = createParamDecorator((_data: unknown, ctx: ExecutionContext): bigint => {
  const req = ctx.switchToHttp().getRequest<Request & { userId: bigint }>();
  return req.userId;
});
