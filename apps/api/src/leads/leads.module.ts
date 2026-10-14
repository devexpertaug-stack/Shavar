import { Module } from '@nestjs/common';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { PipelineService } from './pipeline.service';

@Module({
  controllers: [LeadsController],
  providers: [LeadsService, PipelineService],
  exports: [LeadsService, PipelineService],
})
export class LeadsModule {}
