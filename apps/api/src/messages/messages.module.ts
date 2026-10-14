import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { TemplatesService } from './templates.service';

@Module({
  controllers: [MessagesController],
  providers: [MessagesService, TemplatesService],
  exports: [MessagesService, TemplatesService],
})
export class MessagesModule {}
