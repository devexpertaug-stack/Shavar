import { Body, Controller, Param, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { parseLeadSource } from '@estateflow/shared';
import { Public } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { IntakeService } from './intake.service';

/**
 * Public lead-source webhooks (PRD §8): /webhooks/leads/:source/:tenantKey.
 * Resolves the tenant from the opaque key (RLS-safe), parses the source payload
 * with the right pluggable parser, and ingests with dedup + welcome.
 */
@ApiExcludeController()
@Controller('webhooks/leads')
export class SourcesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly intake: IntakeService,
  ) {}

  @Public()
  @Post(':source/:tenantKey')
  async receive(
    @Param('source') source: string,
    @Param('tenantKey') tenantKey: string,
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    const cred = await this.prisma.findCredentialByKey(tenantKey);
    if (!cred) return { ok: false };

    const parsed = parseLeadSource(source, body ?? req.body);
    const results = [];
    for (const lead of parsed) {
      if (lead.phone) results.push(await this.intake.ingest(cred.tenantId, lead));
    }
    return { ok: true, ingested: results.length, results };
  }
}
