import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, type AuthUser, type Segment } from '@estateflow/shared';
import { CurrentUser, Roles } from '../auth/decorators';
import { CampaignsService } from './campaigns.service';

@ApiTags('campaigns')
@ApiBearerAuth()
@Controller()
@Roles(Role.OWNER, Role.MARKETING)
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get('campaigns')
  list(@CurrentUser() user: AuthUser) {
    return this.campaigns.list(user.tenantId);
  }

  @Post('campaigns/preview')
  @ApiOperation({ summary: 'Audience size for a segment (opt-out excluded)' })
  preview(@CurrentUser() user: AuthUser, @Body() body: { segment: Segment }) {
    return this.campaigns.preview(user.tenantId, body.segment ?? {}).then((count) => ({ count }));
  }

  @Post('campaigns')
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: { name: string; templateName: string; segment: Segment; scheduledAt?: string },
  ) {
    return this.campaigns.create(user.tenantId, body);
  }

  @Post('campaigns/:id/send')
  @ApiOperation({ summary: 'Materialize recipients + dispatch (rate-limited)' })
  send(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.send(user.tenantId, id);
  }

  @Get('campaigns/:id/stats')
  stats(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.stats(user.tenantId, id);
  }

  @Get('sequences')
  listSequences(@CurrentUser() user: AuthUser) {
    return this.campaigns.listSequences(user.tenantId);
  }

  @Post('sequences')
  createSequence(
    @CurrentUser() user: AuthUser,
    @Body() body: { name: string; steps: { dayOffset: number; templateName: string }[]; segment: Segment },
  ) {
    return this.campaigns.createSequence(user.tenantId, body);
  }
}
