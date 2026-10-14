import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@estateflow/shared';
import { Role } from '@estateflow/shared';
import { CurrentUser, Roles } from '../auth/decorators';
import { RolesGuard } from '../auth/roles.guard';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Return the current authenticated user' })
  async me(@CurrentUser() user: AuthUser): Promise<AuthUser> {
    return this.users.me(user);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles(Role.OWNER, Role.SALES_MANAGER)
  @ApiOperation({ summary: 'List users in the caller tenant (Owner / Sales Manager)' })
  async list(@CurrentUser() user: AuthUser) {
    // RLS-scoped: only this tenant's users are ever returned.
    return this.users.listForTenant(user.tenantId);
  }
}
