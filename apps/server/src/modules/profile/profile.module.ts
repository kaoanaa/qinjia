import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { MediaController } from './media.controller';
import { ProfileService } from './profile.service';

@Module({
  controllers: [ProfileController, MediaController],
  providers: [ProfileService],
  exports: [ProfileService],
})
export class ProfileModule {}
