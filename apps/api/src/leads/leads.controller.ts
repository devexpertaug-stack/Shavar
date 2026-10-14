import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@estateflow/shared';
import { Role } from '@estateflow/shared';
import { CurrentUser, Roles } from '../auth/decorators';
import { LeadsService } from './leads.service';
import { PipelineService } from './pipeline.service';
import { AddNoteDto, AssignDto, CreateLeadDto, LeadFiltersDto, UpdateStageDto } from './dto';

@ApiTags('leads')
@ApiBearerAuth()
@Controller('leads')
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly pipeline: PipelineService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List leads (scoped: non-managers see only assigned)' })
  list(@CurrentUser() user: AuthUser, @Query() filters: LeadFiltersDto) {
    return this.leads.list(user, filters);
  }

  @Get('board')
  @ApiOperation({ summary: 'Kanban board — leads grouped by stage (scoped)' })
  board(@CurrentUser() user: AuthUser) {
    return this.leads.board(user);
  }

  @Get('stages')
  @ApiOperation({ summary: 'List pipeline stages for the tenant' })
  stages(@CurrentUser() user: AuthUser) {
    return this.pipeline.list(user.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a lead with its timeline' })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.leads.get(user, id);
  }

  @Post()
  @Roles(Role.OWNER, Role.SALES_MANAGER, Role.MARKETING)
  @ApiOperation({ summary: 'Create a lead (dedups by normalized phone)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateLeadDto) {
    return this.leads.create(user, dto);
  }

  @Patch(':id/stage')
  @ApiOperation({ summary: 'Move a lead to another stage (Lost requires a reason)' })
  changeStage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStageDto,
  ) {
    return this.leads.changeStage(user, id, dto);
  }

  @Patch(':id/assign')
  @Roles(Role.OWNER, Role.SALES_MANAGER)
  @ApiOperation({ summary: 'Assign or reassign a lead (Owner / Sales Manager)' })
  assign(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignDto,
  ) {
    return this.leads.assign(user, id, dto);
  }

  @Patch(':id/takeover')
  @ApiOperation({ summary: 'Human takes over — AI goes silent' })
  takeover(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.leads.takeover(user, id);
  }

  @Patch(':id/release')
  @ApiOperation({ summary: 'Hand the conversation back to the AI' })
  release(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.leads.release(user, id);
  }

  @Post(':id/notes')
  @ApiOperation({ summary: 'Add a note to the lead timeline' })
  addNote(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddNoteDto,
  ) {
    return this.leads.addNote(user, id, dto);
  }
}
