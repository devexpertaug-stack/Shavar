import { describe, it, expect } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { Role } from '@estateflow/shared';
import { TokenService } from './token.service';
import type { AuthConfig } from '../config/auth.config';

const config: AuthConfig = {
  jwtSecret: 'test-access-secret',
  jwtRefreshSecret: 'test-refresh-secret',
  accessTtl: '15m',
  refreshTtl: '30d',
  refreshCookieName: 'ef_refresh',
  cookieSecure: false,
  inviteTtlHours: 72,
  appUrl: 'http://localhost:3000',
};

describe('TokenService', () => {
  const svc = new TokenService(config);

  it('round-trips an access token', () => {
    const token = svc.signAccess({
      sub: '00000000-0000-0000-0000-000000000001',
      tid: '00000000-0000-0000-0000-0000000000aa',
      role: Role.OWNER,
      teamId: null,
      email: 'owner@demo.test',
    });
    const decoded = svc.verifyAccess(token);
    expect(decoded.role).toBe(Role.OWNER);
    expect(decoded.email).toBe('owner@demo.test');
  });

  it('round-trips a refresh token with tokenVersion', () => {
    const token = svc.signRefresh({
      sub: '00000000-0000-0000-0000-000000000001',
      tid: '00000000-0000-0000-0000-0000000000aa',
      tv: 3,
    });
    expect(svc.verifyRefresh(token).tv).toBe(3);
  });

  it('rejects an access token signed with the wrong secret', () => {
    const other = new TokenService({ ...config, jwtSecret: 'different' });
    const token = other.signAccess({
      sub: '00000000-0000-0000-0000-000000000001',
      tid: '00000000-0000-0000-0000-0000000000aa',
      role: Role.OWNER,
      teamId: null,
      email: 'owner@demo.test',
    });
    expect(() => svc.verifyAccess(token)).toThrow(UnauthorizedException);
  });

  it('does not accept a refresh token as an access token', () => {
    const refresh = svc.signRefresh({
      sub: '00000000-0000-0000-0000-000000000001',
      tid: '00000000-0000-0000-0000-0000000000aa',
      tv: 0,
    });
    expect(() => svc.verifyAccess(refresh)).toThrow(UnauthorizedException);
  });
});
