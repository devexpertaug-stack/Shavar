import type { Role } from '@estateflow/shared';

export interface NavItem {
  label: string;
  href: string;
  /** Roles allowed to see this item. OWNER sees everything regardless. */
  roles: Role[];
}

/**
 * Role-aware navigation (PRD §3). Only items whose `roles` include the user's
 * role (or the user is OWNER) are shown. Hrefs are placeholders for now; the
 * corresponding pages land in later tasks.
 */
export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/app', roles: ['OWNER', 'SALES_MANAGER', 'MARKETING'] },
  {
    label: 'Leads',
    href: '/app/leads',
    roles: ['OWNER', 'SALES_MANAGER', 'TELE_CALLER'],
  },
  { label: 'Inbox', href: '/app/inbox', roles: ['OWNER', 'SALES_MANAGER', 'TELE_CALLER'] },
  { label: 'Call Queue', href: '/app/queue', roles: ['TELE_CALLER'] },
  { label: 'Site Visits', href: '/app/visits', roles: ['FIELD_AGENT', 'SALES_MANAGER'] },
  { label: 'Inventory', href: '/app/inventory', roles: ['OWNER', 'SALES_MANAGER', 'MARKETING'] },
  { label: 'Campaigns', href: '/app/campaigns', roles: ['MARKETING'] },
  { label: 'Team', href: '/app/team', roles: ['OWNER', 'SALES_MANAGER'] },
  { label: 'Settings', href: '/app/settings', roles: ['OWNER'] },
];

export function navForRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => role === 'OWNER' || item.roles.includes(role));
}
