import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@estateflow/shared';
import { CurrentUser } from '../auth/decorators';
import { VisitsService } from './visits.service';

@ApiTags('site-visits')
@ApiBearerAuth()
@Controller('site-visits')
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}

  @Get()
  @ApiOperation({ summary: 'List site visits (scoped: agents see their own)' })
  list(@CurrentUser() user: AuthUser) {
    return this.visits.list(user);
  }

  @Get('slots')
  @ApiOperation({ summary: 'Available slots (optionally for a specific agent)' })
  slots(@CurrentUser() user: AuthUser, @Query('agentId') agentId?: string) {
    return this.visits.availableSlots(user.tenantId, agentId);
  }

  @Post()
  @ApiOperation({ summary: 'Book a site visit (prevents double-booking)' })
  book(
    @CurrentUser() user: AuthUser,
    @Body() body: { leadId: string; slotAt: string; agentId?: string; unitId?: string; projectId?: string },
  ) {
    return this.visits.book(user.tenantId, body);
  }

  @Post(':id/checkin')
  @ApiOperation({ summary: 'Field agent GPS check-in' })
  checkIn(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: { geo: string }) {
    return this.visits.checkIn(user, id, body.geo);
  }

  @Post(':id/checkout')
  @ApiOperation({ summary: 'Field agent GPS check-out + feedback (moves to Visited)' })
  checkOut(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { geo: string; feedback?: string },
  ) {
    return this.visits.checkOut(user, id, body.geo, body.feedback);
  }
}
