import { z } from 'zod';

/**
 * RBAC roles (PRD §3). Permissions are enforced server-side on every endpoint
 * and every row via tenant_id + role + assignment/team scope.
 */
export const Role = {
  OWNER: 'OWNER',
  SALES_MANAGER: 'SALES_MANAGER',
  TELE_CALLER: 'TELE_CALLER',
  FIELD_AGENT: 'FIELD_AGENT',
  MARKETING: 'MARKETING',
  // v2 roles — modeled now so RLS/scoping is ready, surfaced later.
  POST_SALES: 'POST_SALES',
  CHANNEL_PARTNER: 'CHANNEL_PARTNER',
} as const;

export type Role = (typeof Role)[keyof typeof Role];

export const RoleSchema = z.nativeEnum(Role);

export const ALL_ROLES: Role[] = Object.values(Role);

/** Roles that are active in v1 (PRD §11 defers POST_SALES and CHANNEL_PARTNER). */
export const V1_ROLES: Role[] = [
  Role.OWNER,
  Role.SALES_MANAGER,
  Role.TELE_CALLER,
  Role.FIELD_AGENT,
  Role.MARKETING,
];
