import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { AuthUser, LoginResponse } from '@estateflow/shared';
import { Role } from '@estateflow/shared';
import { AuthService, type IssuedTokens } from './auth.service';
import { AcceptInviteDto, InviteDto, LoginDto } from './dto';
import { CurrentUser, Public, Roles } from './decorators';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { AUTH_CONFIG, type AuthConfig } from '../config/auth.config';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(this.config.refreshCookieName, token, {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: 'lax',
      path: '/api/v1/auth',
      domain: this.config.cookieDomain,
      maxAge: 30 * 24 * 3600 * 1000,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(this.config.refreshCookieName, { path: '/api/v1/auth' });
  }

  private respond(res: Response, result: LoginResponse & IssuedTokens): void {
    this.setRefreshCookie(res, result.refreshToken);
    const body: LoginResponse = { accessToken: result.accessToken, user: result.user };
    res.json(body);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Log in with tenant slug + email + password' })
  async login(@Body() dto: LoginDto, @Res() res: Response): Promise<void> {
    const result = await this.auth.login(dto.tenantSlug, dto.email, dto.password);
    this.respond(res, result);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate access + refresh tokens via the refresh cookie' })
  async refresh(@Req() req: Request, @Res() res: Response): Promise<void> {
    const token = (req.cookies as Record<string, string> | undefined)?.[
      this.config.refreshCookieName
    ];
    if (!token) throw new UnauthorizedException('No refresh token');
    const result = await this.auth.refresh(token);
    this.respond(res, result);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke outstanding refresh tokens and clear the cookie' })
  async logout(@CurrentUser() user: AuthUser, @Res() res: Response): Promise<void> {
    await this.auth.logout(user.id);
    this.clearRefreshCookie(res);
    res.status(204).send();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.OWNER, Role.SALES_MANAGER)
  @ApiBearerAuth()
  @Post('invite')
  @ApiOperation({ summary: 'Invite a user to the tenant (Owner / Sales Manager)' })
  async invite(@CurrentUser() user: AuthUser, @Body() dto: InviteDto) {
    return this.auth.invite(user.tenantId, user.id, dto);
  }

  @Public()
  @Post('accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Accept an invite and set a password' })
  async accept(@Body() dto: AcceptInviteDto, @Res() res: Response): Promise<void> {
    const result = await this.auth.acceptInvite(dto.token, dto.password);
    this.respond(res, result);
  }
}
