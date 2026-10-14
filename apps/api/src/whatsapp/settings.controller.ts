import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, type AuthUser } from '@estateflow/shared';
import { CurrentUser, Roles } from '../auth/decorators';
import { ProviderSettingsService } from './provider-settings.service';
import { UpsertProviderDto } from './dto';

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings/providers')
@Roles(Role.OWNER)
export class SettingsController {
  constructor(private readonly providers: ProviderSettingsService) {}

  @Get()
  @ApiOperation({ summary: 'List WhatsApp provider credentials (Owner)' })
  list(@CurrentUser() user: AuthUser) {
    return this.providers.list(user.tenantId);
  }

  @Put()
  @ApiOperation({ summary: 'Create/update a provider credential (encrypted at rest)' })
  upsert(@CurrentUser() user: AuthUser, @Body() dto: UpsertProviderDto) {
    return this.providers.upsert(user.tenantId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a provider credential' })
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.providers.remove(user.tenantId, id);
    return { ok: true };
  }
}
