import { describe, it, expect, beforeEach } from 'vitest';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role, type AccessTokenPayload } from '@estateflow/shared';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { TokenService } from './token.service';

const payload: AccessTokenPayload = {
  sub: '00000000-0000-0000-0000-000000000001',
  tid: '00000000-0000-0000-0000-0000000000aa',
  role: Role.TELE_CALLER,
  teamId: null,
  email: 'caller@demo.test',
};

function makeCtx(headers: Record<string, string>): {
  ctx: ExecutionContext;
  req: { user?: unknown; tenantId?: string; headers: Record<string, string> };
} {
  const req = { headers } as { user?: unknown; tenantId?: string; headers: Record<string, string> };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { ctx, req };
}

describe('JwtAuthGuard', () => {
  let reflector: Reflector;
  let tokens: TokenService;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    reflector = new Reflector();
    reflector.getAllAndOverride = () => false as never; // not public
    tokens = {
      verifyAccess: (t: string) => {
        if (t !== 'good') throw new UnauthorizedException();
        return payload;
      },
    } as unknown as TokenService;
    guard = new JwtAuthGuard(reflector, tokens);
  });

  it('skips auth for @Public() routes', () => {
    reflector.getAllAndOverride = () => true as never;
    const { ctx } = makeCtx({});
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects a missing Authorization header', () => {
    const { ctx } = makeCtx({});
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects a non-bearer scheme', () => {
    const { ctx } = makeCtx({ authorization: 'Basic abc' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects an invalid token', () => {
    const { ctx } = makeCtx({ authorization: 'Bearer bad' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('attaches user + tenantId on a valid token', () => {
    const { ctx, req } = makeCtx({ authorization: 'Bearer good' });
    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.tenantId).toBe(payload.tid);
    expect((req.user as AccessTokenPayload & { role: Role }).role).toBe(Role.TELE_CALLER);
  });
});
