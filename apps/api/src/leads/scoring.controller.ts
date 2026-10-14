import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, type AuthUser } from '@estateflow/shared';
import { CurrentUser, Roles } from '../auth/decorators';
import { ScoringService } from './scoring.service';

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings/scoring')
export class ScoringController {
  constructor(private readonly scoring: ScoringService) {}

  @Get('weights')
  @ApiOperation({ summary: 'Get the tenant scoring weights' })
  getWeights(@CurrentUser() user: AuthUser) {
    return this.scoring.getWeights(user.tenantId);
  }

  @Put('weights')
  @Roles(Role.OWNER)
  @ApiOperation({ summary: 'Update the tenant scoring weights (Owner)' })
  setWeights(@CurrentUser() user: AuthUser, @Body() body: Record<string, number>) {
    return this.scoring.setWeights(user.tenantId, body);
  }

  @Post('decay')
  @Roles(Role.OWNER)
  @ApiOperation({ summary: 'Run the decay pass now (also runs nightly)' })
  decay(@CurrentUser() user: AuthUser) {
    return this.scoring.decayAll(user.tenantId);
  }
}
