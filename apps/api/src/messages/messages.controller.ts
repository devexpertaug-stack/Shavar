import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, type AuthUser } from '@estateflow/shared';
import { CurrentUser, Roles } from '../auth/decorators';
import { MessagesService } from './messages.service';
import { TemplatesService } from './templates.service';
import { MessageHistoryQuery, SendMessageDto, UpsertTemplateDto } from './dto';

@ApiTags('inbox')
@ApiBearerAuth()
@Controller()
export class MessagesController {
  constructor(
    private readonly messages: MessagesService,
    private readonly templates: TemplatesService,
  ) {}

  @Get('inbox/conversations')
  @ApiOperation({ summary: 'Conversation list (scoped to the caller)' })
  conversations(@CurrentUser() user: AuthUser) {
    return this.messages.conversations(user);
  }

  @Get('leads/:id/messages')
  @ApiOperation({ summary: 'Message thread for a lead' })
  thread(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: MessageHistoryQuery,
  ) {
    return this.messages.thread(user, id, q.limit);
  }

  @Post('leads/:id/messages')
  @ApiOperation({ summary: 'Send an outbound message (text/media/template)' })
  send(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.messages.send(user, id, dto);
  }

  @Get('templates')
  @ApiOperation({ summary: 'List message templates' })
  listTemplates(@CurrentUser() user: AuthUser) {
    return this.templates.list(user.tenantId);
  }

  @Put('templates')
  @Roles(Role.OWNER, Role.MARKETING)
  @ApiOperation({ summary: 'Create/update a template (Owner / Marketing)' })
  upsertTemplate(@CurrentUser() user: AuthUser, @Body() dto: UpsertTemplateDto) {
    return this.templates.upsert(user.tenantId, dto);
  }

  @Post('templates/sync')
  @Roles(Role.OWNER, Role.MARKETING)
  @ApiOperation({ summary: 'Sync templates from the provider' })
  syncTemplates(@CurrentUser() user: AuthUser) {
    return this.templates.sync(user.tenantId);
  }
}
