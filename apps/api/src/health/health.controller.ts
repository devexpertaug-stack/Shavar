import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { HealthResponse } from '@estateflow/shared';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOkResponse({ description: 'Liveness/readiness report for DB and Redis.' })
  async check(@Res() res: Response): Promise<void> {
    const report: HealthResponse = await this.health.check();
    // 200 when fully healthy, 503 otherwise, so uptime monitors can alert.
    res.status(report.status === 'ok' ? 200 : 503).json(report);
  }
}
