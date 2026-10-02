import { Module } from '@nestjs/common';
import { ProfileModule } from '../profile/profile.module';
import { UnlockModule } from '../unlock/unlock.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
  imports: [ProfileModule, UnlockModule],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
