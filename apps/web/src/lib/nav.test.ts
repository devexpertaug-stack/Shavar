import { describe, it, expect } from 'vitest';
import { navForRole, NAV_ITEMS } from './nav';

describe('navForRole', () => {
  it('shows every item to OWNER', () => {
    expect(navForRole('OWNER')).toHaveLength(NAV_ITEMS.length);
  });

  it('shows the call queue only to tele-callers', () => {
    const callerLabels = navForRole('TELE_CALLER').map((i) => i.label);
    expect(callerLabels).toContain('Call Queue');
    expect(navForRole('SALES_MANAGER').map((i) => i.label)).not.toContain('Call Queue');
  });

  it('hides Settings from everyone except OWNER', () => {
    for (const role of ['SALES_MANAGER', 'TELE_CALLER', 'FIELD_AGENT', 'MARKETING'] as const) {
      expect(navForRole(role).map((i) => i.label)).not.toContain('Settings');
    }
    expect(navForRole('OWNER').map((i) => i.label)).toContain('Settings');
  });

  it('shows Campaigns to marketing', () => {
    expect(navForRole('MARKETING').map((i) => i.label)).toContain('Campaigns');
  });

  it('shows Site Visits to field agents', () => {
    expect(navForRole('FIELD_AGENT').map((i) => i.label)).toContain('Site Visits');
  });
});
