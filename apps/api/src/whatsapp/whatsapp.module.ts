import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { WebhookController } from './webhook.controller';
import { ProviderSettingsService } from './provider-settings.service';

@Module({
  controllers: [SettingsController, WebhookController],
  providers: [ProviderSettingsService],
  exports: [ProviderSettingsService],
})
export class WhatsAppModule {}
