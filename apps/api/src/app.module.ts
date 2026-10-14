import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { LeadsModule } from './leads/leads.module';
import { MessagesModule } from './messages/messages.module';
import { RoutingModule } from './routing/routing.module';
import { InventoryModule } from './inventory/inventory.module';
import { CallsModule } from './calls/calls.module';
import { VisitsModule } from './visits/visits.module';
import { SourcesModule } from './sources/sources.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { CryptoModule } from './crypto/crypto.module';
import { QueueModule } from './queue/queue.module';
import { RealtimeModule } from './realtime/realtime.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RedisModule,
    CryptoModule,
    QueueModule,
    RealtimeModule,
    HealthModule,
    AuthModule,
    UsersModule,
    LeadsModule,
    MessagesModule,
    RoutingModule,
    InventoryModule,
    CallsModule,
    VisitsModule,
    SourcesModule,
    CampaignsModule,
    AnalyticsModule,
    WhatsAppModule,
  ],
})
export class AppModule {}
