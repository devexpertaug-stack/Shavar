import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthUser } from '@estateflow/shared';
import { IS_PUBLIC_KEY } from './decorators';
import { TokenService } from './token.service';

/**
 * Authenticates requests via the Bearer access token. On success it attaches an
 * AuthUser (and tenantId) to the request so downstream guards/interceptors can
 * authorize and scope. Routes marked @Public() are skipped.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser; tenantId?: string }>();
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const payload = this.tokens.verifyAccess(header.slice('Bearer '.length).trim());

    const user: AuthUser = {
      id: payload.sub,
      tenantId: payload.tid,
      email: payload.email,
      name: '',
      role: payload.role,
      teamId: payload.teamId,
      languages: [],
    };
    req.user = user;
    req.tenantId = payload.tid;
    return true;
  }
}
