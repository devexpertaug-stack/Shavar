import type { AuthUser, Role } from '@estateflow/shared';
import type { Prisma } from '@prisma/client';

/**
 * Roles that may see every lead in the tenant. Everyone else is restricted to
 * leads assigned to them (PRD §3: Tele-caller sees only their assigned leads,
 * Field agent only their visits). RLS already scopes by tenant; this adds the
 * per-row assignment scope on top.
 */
const FULL_VISIBILITY_ROLES: Role[] = ['OWNER', 'SALES_MANAGER', 'MARKETING'];

export function canSeeAllLeads(role: Role): boolean {
  return FULL_VISIBILITY_ROLES.includes(role);
}

/** Prisma `where` fragment that enforces the per-row assignment scope. */
export function leadScopeWhere(user: AuthUser): Prisma.LeadWhereInput {
  if (canSeeAllLeads(user.role)) return {};
  return { assignedTo: user.id };
}
