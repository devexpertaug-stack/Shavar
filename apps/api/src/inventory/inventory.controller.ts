import { Body, Controller, Get, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, type AuthUser } from '@estateflow/shared';
import { CurrentUser, Roles } from '../auth/decorators';
import { InventoryService } from './inventory.service';
import { CreateProjectDto, CreateUnitDto, SendUnitDto } from './dto';

@ApiTags('inventory')
@ApiBearerAuth()
@Controller()
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('projects')
  listProjects(@CurrentUser() user: AuthUser) {
    return this.inventory.listProjects(user.tenantId);
  }

  @Post('projects')
  @Roles(Role.OWNER, Role.SALES_MANAGER, Role.MARKETING)
  createProject(@CurrentUser() user: AuthUser, @Body() dto: CreateProjectDto) {
    return this.inventory.createProject(user.tenantId, dto);
  }

  @Get('units')
  listUnits(@CurrentUser() user: AuthUser, @Query('projectId') projectId?: string) {
    return this.inventory.listUnits(user.tenantId, projectId);
  }

  @Post('units')
  @Roles(Role.OWNER, Role.SALES_MANAGER, Role.MARKETING)
  createUnit(@CurrentUser() user: AuthUser, @Body() dto: CreateUnitDto) {
    return this.inventory.createUnit(user.tenantId, dto);
  }

  @Post('units/import')
  @Roles(Role.OWNER, Role.SALES_MANAGER, Role.MARKETING)
  @ApiOperation({ summary: 'Bulk import units from CSV text' })
  importCsv(@CurrentUser() user: AuthUser, @Body() body: { csv: string }) {
    return this.inventory.importCsv(user.tenantId, body.csv ?? '');
  }

  @Get('units/match')
  @ApiOperation({ summary: 'Top matching units for a lead (filters + vector rank)' })
  match(@CurrentUser() user: AuthUser, @Query('leadId', ParseUUIDPipe) leadId: string) {
    return this.inventory.match(user.tenantId, leadId);
  }

  @Post('units/send')
  @ApiOperation({ summary: 'Send a unit brochure or location to the lead on WhatsApp' })
  send(@CurrentUser() user: AuthUser, @Body() dto: SendUnitDto) {
    return this.inventory.sendUnit(user.tenantId, dto.leadId, dto.unitId, dto.what ?? 'brochure');
  }
}
