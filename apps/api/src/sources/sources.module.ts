import { Module } from '@nestjs/common';
import { SourcesController } from './sources.controller';
import { IntakeService } from './intake.service';

@Module({
  controllers: [SourcesController],
  providers: [IntakeService],
  exports: [IntakeService],
})
export class SourcesModule {}
