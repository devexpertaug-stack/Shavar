import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { AuthUser, LoginResponse, Role } from '@estateflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { AUTH_CONFIG, type AuthConfig } from '../config/auth.config';
import type { InviteDto } from './dto';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  private toAuthUser(u: {
    id: string;
    tenantId: string;
    email: string;
    name: string;
    role: Role;
    teamId: string | null;
    languages: string[];
  }): AuthUser {
    return {
      id: u.id,
      tenantId: u.tenantId,
      email: u.email,
      name: u.name,
      role: u.role,
      teamId: u.teamId,
      languages: u.languages,
    };
  }

  private issue(user: AuthUser, tokenVersion: number): IssuedTokens {
    return {
      accessToken: this.tokens.signAccess({
        sub: user.id,
        tid: user.tenantId,
        role: user.role,
        teamId: user.teamId,
        email: user.email,
      }),
      refreshToken: this.tokens.signRefresh({
        sub: user.id,
        tid: user.tenantId,
        tv: tokenVersion,
      }),
    };
  }

  /** Resolve tenant + user and verify the password. Bootstrap read (unscoped). */
  async login(
    tenantSlug: string,
    email: string,
    password: string,
  ): Promise<LoginResponse & IssuedTokens> {
    // Bootstrap reads go through SECURITY DEFINER functions (RLS-safe) since no
    // tenant context exists yet.
    const tenant = await this.prisma.authFindTenantBySlug(tenantSlug);
    if (!tenant) throw new UnauthorizedException('Invalid credentials');

    const user = await this.prisma.authFindUserForLogin(tenant.id, email.toLowerCase());
    // Don't reveal whether the email exists.
    if (!user || !user.isActive || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const ok = await this.passwords.verify(user.passwordHash, password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    await this.prisma.withTenant(tenant.id, (tx) =>
      tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
    );

    const authUser = this.toAuthUser(user);
    return { user: authUser, ...this.issue(authUser, user.tokenVersion) };
  }

  /** Rotate tokens from a refresh token, checking tokenVersion for revocation. */
  async refresh(refreshToken: string): Promise<LoginResponse & IssuedTokens> {
    const payload = this.tokens.verifyRefresh(refreshToken);
    const user = await this.prisma.authFindUserById(payload.sub);
    if (!user || !user.isActive || user.tenantId !== payload.tid) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (user.tokenVersion !== payload.tv) {
      throw new UnauthorizedException('Refresh token has been revoked');
    }
    const authUser = this.toAuthUser(user);
    return { user: authUser, ...this.issue(authUser, user.tokenVersion) };
  }

  /** Invalidate all outstanding refresh tokens by bumping tokenVersion. */
  async logout(userId: string): Promise<void> {
    const user = await this.prisma.authFindUserById(userId);
    if (!user) return;
    await this.prisma
      .withTenant(user.tenantId, (tx) =>
        tx.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } }),
      )
      .catch(() => undefined);
  }

  /**
   * Create an invite for a user in the actor's tenant. Returns the raw token
   * (only time it's available) plus the acceptance URL. Tenant-scoped write.
   */
  async invite(
    tenantId: string,
    invitedBy: string,
    dto: InviteDto,
  ): Promise<{ inviteId: string; token: string; acceptUrl: string; expiresAt: Date }> {
    const email = dto.email.toLowerCase();

    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.user.findUnique({
        where: { tenantId_email: { tenantId, email } },
      });
      if (existing) throw new ConflictException('A user with that email already exists');

      if (dto.teamId) {
        const team = await tx.team.findFirst({ where: { id: dto.teamId, tenantId } });
        if (!team) throw new BadRequestException('Team not found in this tenant');
      }

      const rawToken = randomBytes(32).toString('base64url');
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + this.config.inviteTtlHours * 3600_000);

      const invite = await tx.invite.create({
        data: {
          tenantId,
          email,
          name: dto.name,
          role: dto.role,
          teamId: dto.teamId ?? null,
          languages: dto.languages ?? [],
          tokenHash,
          invitedBy,
          expiresAt,
        },
      });

      return {
        inviteId: invite.id,
        token: rawToken,
        acceptUrl: `${this.config.appUrl}/accept-invite?token=${rawToken}`,
        expiresAt,
      };
    });
  }

  /** Accept an invite: create the user with a password, mark invite accepted. */
  async acceptInvite(token: string, password: string): Promise<LoginResponse & IssuedTokens> {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const invite = await this.prisma.authFindInviteByHash(tokenHash);
    if (!invite || invite.status !== 'PENDING') {
      throw new BadRequestException('Invalid or already-used invite');
    }
    if (invite.expiresAt.getTime() < Date.now()) {
      await this.prisma.withTenant(invite.tenantId, (tx) =>
        tx.invite.update({ where: { id: invite.id }, data: { status: 'EXPIRED' } }),
      );
      throw new BadRequestException('Invite has expired');
    }

    const passwordHash = await this.passwords.hash(password);

    const user = await this.prisma.withTenant(invite.tenantId, async (tx) => {
      const created = await tx.user.create({
        data: {
          tenantId: invite.tenantId,
          email: invite.email,
          name: invite.name,
          role: invite.role,
          teamId: invite.teamId,
          languages: invite.languages,
          passwordHash,
        },
      });
      await tx.invite.update({
        where: { id: invite.id },
        data: { status: 'ACCEPTED', acceptedAt: new Date() },
      });
      return created;
    });

    const authUser = this.toAuthUser(user);
    return { user: authUser, ...this.issue(authUser, user.tokenVersion) };
  }
}
