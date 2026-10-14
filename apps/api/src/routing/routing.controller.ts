import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, type AuthUser } from '@estateflow/shared';
import { CurrentUser, Roles } from '../auth/decorators';
import { RoutingService } from './routing.service';
import { NotificationsService } from './notifications.service';
import { UpsertRoutingRuleDto } from './dto';

@ApiTags('routing')
@ApiBearerAuth()
@Controller()
export class RoutingController {
  constructor(
    private readonly routing: RoutingService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get('routing-rules')
  @Roles(Role.OWNER, Role.SALES_MANAGER)
  @ApiOperation({ summary: 'List routing rules (Owner / Sales Manager)' })
  list(@CurrentUser() user: AuthUser) {
    return this.routing.list(user.tenantId);
  }

  @Post('routing-rules')
  @Roles(Role.OWNER, Role.SALES_MANAGER)
  create(@CurrentUser() user: AuthUser, @Body() dto: UpsertRoutingRuleDto) {
    return this.routing.create(user.tenantId, dto);
  }

  @Put('routing-rules/:id')
  @Roles(Role.OWNER, Role.SALES_MANAGER)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertRoutingRuleDto,
  ) {
    return this.routing.update(user.tenantId, id, dto);
  }

  @Delete('routing-rules/:id')
  @Roles(Role.OWNER, Role.SALES_MANAGER)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.routing.remove(user.tenantId, id);
    return { ok: true };
  }

  @Get('notifications')
  @ApiOperation({ summary: 'List my notifications' })
  listNotifications(@CurrentUser() user: AuthUser) {
    return this.notifications.list(user);
  }

  @Patch('notifications/:id/read')
  markRead(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(user, id);
  }
}
