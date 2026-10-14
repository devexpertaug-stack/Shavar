import { Controller, Get, Header, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, type AuthUser } from '@estateflow/shared';
import { CurrentUser, Roles } from '../auth/decorators';
import { AnalyticsService } from './analytics.service';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
@Roles(Role.OWNER, Role.SALES_MANAGER)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Headline KPIs' })
  overview(@CurrentUser() user: AuthUser) {
    return this.analytics.overview(user.tenantId);
  }

  @Get('funnel')
  funnel(@CurrentUser() user: AuthUser) {
    return this.analytics.funnel(user.tenantId);
  }

  @Get('agents')
  agents(@CurrentUser() user: AuthUser) {
    return this.analytics.agents(user.tenantId);
  }

  @Get('sources')
  sources(@CurrentUser() user: AuthUser) {
    return this.analytics.sources(user.tenantId);
  }

  @Get('feed')
  feed(@CurrentUser() user: AuthUser) {
    return this.analytics.feed(user.tenantId);
  }

  @Get('export/leads')
  @Header('Content-Type', 'text/csv')
  @ApiOperation({ summary: 'CSV export of leads (audit-logged)' })
  async exportLeads(@CurrentUser() user: AuthUser, @Res() res: Response): Promise<void> {
    const csv = await this.analytics.exportLeadsCsv(user);
    res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
    res.send(csv);
  }
}
