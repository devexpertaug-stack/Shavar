import { describe, it, expect, beforeEach } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role, type AuthUser } from '@estateflow/shared';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from './decorators';

function ctxWithUser(user: AuthUser | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

const baseUser = (role: Role): AuthUser => ({
  id: '00000000-0000-0000-0000-000000000001',
  tenantId: '00000000-0000-0000-0000-0000000000aa',
  email: 'u@demo.test',
  name: 'U',
  role,
  teamId: null,
  languages: [],
});

describe('RolesGuard', () => {
  let reflector: Reflector;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  function withRequired(roles: Role[] | undefined): void {
    reflector.getAllAndOverride = () => roles as never;
  }

  it('allows when no roles are required', () => {
    withRequired(undefined);
    expect(guard.canActivate(ctxWithUser(baseUser(Role.TELE_CALLER)))).toBe(true);
  });

  it('allows a user whose role is in the required set', () => {
    withRequired([Role.SALES_MANAGER]);
    expect(guard.canActivate(ctxWithUser(baseUser(Role.SALES_MANAGER)))).toBe(true);
  });

  it('always allows OWNER (superset)', () => {
    withRequired([Role.MARKETING]);
    expect(guard.canActivate(ctxWithUser(baseUser(Role.OWNER)))).toBe(true);
  });

  it('forbids a tele-caller from an owner/manager-only route', () => {
    withRequired([Role.OWNER, Role.SALES_MANAGER]);
    expect(() => guard.canActivate(ctxWithUser(baseUser(Role.TELE_CALLER)))).toThrow(
      ForbiddenException,
    );
  });

  it('forbids when there is no authenticated user', () => {
    withRequired([Role.OWNER]);
    expect(() => guard.canActivate(ctxWithUser(undefined))).toThrow(ForbiddenException);
  });

  it('uses the metadata key the decorator sets', () => {
    expect(ROLES_KEY).toBe('roles');
  });
});
