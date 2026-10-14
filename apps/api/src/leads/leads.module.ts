import { Module } from '@nestjs/common';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { PipelineService } from './pipeline.service';
import { ScoringService } from './scoring.service';
import { ScoringController } from './scoring.controller';

@Module({
  controllers: [LeadsController, ScoringController],
  providers: [LeadsService, PipelineService, ScoringService],
  exports: [LeadsService, PipelineService, ScoringService],
})
export class LeadsModule {}
