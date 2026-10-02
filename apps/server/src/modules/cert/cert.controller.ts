import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CertService } from './cert.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUserId } from '../auth/current-user.decorator';
import { FaceInitDto, FaceVerifyDto, IdCardOcrDto } from './dto/cert.dto';

@Controller('cert')
@UseGuards(JwtAuthGuard)
export class CertController {
  constructor(private readonly service: CertService) {}

  @Post('idcard-ocr')
  @HttpCode(200)
  ocr(@CurrentUserId() userId: bigint, @Body() dto: IdCardOcrDto) {
    return this.service.idCardOcr(userId, dto.objectKey);
  }

  @Post('face-init')
  @HttpCode(200)
  faceInit(@CurrentUserId() userId: bigint, @Body() dto: FaceInitDto) {
    return this.service.faceInit(userId, dto.certId);
  }

  @Post('face-verify')
  @HttpCode(200)
  faceVerify(@CurrentUserId() userId: bigint, @Body() dto: FaceVerifyDto) {
    return this.service.faceVerify(userId, dto.sessionId);
  }
}
