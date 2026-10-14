import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthUser } from '@estateflow/shared';
import { CurrentUser, Public } from '../auth/decorators';
import { CallsService } from './calls.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('calls')
@Controller()
export class CallsController {
  constructor(
    private readonly calls: CallsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('queue/next-best-calls')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Ranked Next Best Call queue for the caller' })
  queue(@CurrentUser() user: AuthUser) {
    return this.calls.nextBestCalls(user);
  }

  @Post('calls/click-to-call')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Dial a lead (masked) and log the call' })
  clickToCall(@CurrentUser() user: AuthUser, @Body() body: { leadId: string; agentNumber: string }) {
    return this.calls.clickToCall(user, body.leadId, body.agentNumber);
  }

  @Post('calls/:id/outcome')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Log the mandatory call outcome + next follow-up' })
  outcome(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { outcome: string; nextFollowupAt?: string },
  ) {
    return this.calls.logOutcome(user, id, body.outcome, body.nextFollowupAt);
  }

  @Public()
  @Post('webhooks/exotel/:tenantKey')
  @ApiExcludeEndpoint()
  async webhook(
    @Param('tenantKey') tenantKey: string,
    @Req() req: Request,
    @Query() query: Record<string, string>,
  ) {
    const cred = await this.prisma.findCredentialByKey(tenantKey);
    if (!cred) return { ok: false };
    const body = { ...(req.body as Record<string, unknown>), ...query };
    return this.calls.handleWebhook(cred.tenantId, body);
  }
}
