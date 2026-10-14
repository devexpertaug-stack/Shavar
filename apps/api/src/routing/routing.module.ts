import { Module } from '@nestjs/common';
import { RoutingController } from './routing.controller';
import { RoutingService } from './routing.service';
import { NotificationsService } from './notifications.service';

@Module({
  controllers: [RoutingController],
  providers: [RoutingService, NotificationsService],
  exports: [RoutingService, NotificationsService],
})
export class RoutingModule {}
