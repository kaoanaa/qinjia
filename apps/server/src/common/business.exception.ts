import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 带机器可读 errorCode 的业务异常（对应 openapi Error{code,message,errorCode}）。
 * 验收用例依赖固定 errorCode（如 COMMITMENT_REQUIRED），禁止用裸 message 断言。
 */
export class BusinessException extends HttpException {
  constructor(status: HttpStatus, readonly errorCode: string, message: string) {
    super({ message, errorCode }, status);
  }

  static forbidden(errorCode: string, message: string): BusinessException {
    return new BusinessException(HttpStatus.FORBIDDEN, errorCode, message);
  }
}
