import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UploadTokenDto } from './dto/upload-token.dto';

@Controller('media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(private readonly service: ProfileService) {}

  /** 私有桶直传凭证（照片/证明/身份证），先传后提交 objectKey */
  @Post('upload-token')
  @HttpCode(200)
  uploadToken(@Body() dto: UploadTokenDto) {
    return this.service.uploadToken(dto.bucket, dto.mime);
  }
}
