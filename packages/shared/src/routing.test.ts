import { describe, it, expect } from 'vitest';
import { matchRule, selectAssignee, type RoutingRule, type Candidate } from './routing';

const rules: RoutingRule[] = [
  {
    id: 'r1',
    priority: 1,
    isActive: true,
    conditions: { tier: 'HOT', language: 'hi' },
    action: { strategy: 'round_robin', requireLanguage: 'hi' },
  },
  {
    id: 'r2',
    priority: 2,
    isActive: true,
    conditions: { source: 'WEBSITE' },
    action: { strategy: 'least_loaded' },
  },
  {
    id: 'r3',
    priority: 3,
    isActive: false,
    conditions: {},
    action: { strategy: 'round_robin' },
  },
];

describe('matchRule', () => {
  it('matches the highest-priority rule whose conditions hold', () => {
    const r = matchRule(rules, { tier: 'HOT', language: 'hi' });
    expect(r?.id).toBe('r1');
  });
  it('falls through to a lower-priority rule when the first does not match', () => {
    const r = matchRule(rules, { tier: 'WARM', source: 'WEBSITE' });
    expect(r?.id).toBe('r2');
  });
  it('ignores inactive rules', () => {
    const r = matchRule(rules, { tier: 'COLD', source: 'MANUAL' });
    expect(r).toBeNull();
  });
  it('matches on location case-insensitively', () => {
    const locRule: RoutingRule = {
      id: 'loc', priority: 0, isActive: true,
      conditions: { location: 'Wakad' }, action: { strategy: 'round_robin' },
    };
    expect(matchRule([locRule], { locations: ['wakad'] })?.id).toBe('loc');
    expect(matchRule([locRule], { locations: ['Baner'] })).toBeNull();
  });
});

function cand(id: string, over: Partial<Candidate> = {}): Candidate {
  return { id, teamId: null, languages: ['en'], activeLeadCount: 0, maxActiveLeads: 100, ...over };
}

describe('selectAssignee', () => {
  it('round-robin rotates across candidates by cursor', () => {
    const pool = [cand('a'), cand('b'), cand('c')];
    const r0 = selectAssignee({ strategy: 'round_robin' }, pool, 0);
    const r1 = selectAssignee({ strategy: 'round_robin' }, pool, 1);
    const r2 = selectAssignee({ strategy: 'round_robin' }, pool, 2);
    const r3 = selectAssignee({ strategy: 'round_robin' }, pool, 3);
    expect(new Set([r0, r1, r2])).toEqual(new Set(['a', 'b', 'c']));
    expect(r3).toBe(r0); // wraps around => fair
  });

  it('least-loaded picks the candidate with the fewest active leads', () => {
    const pool = [cand('a', { activeLeadCount: 5 }), cand('b', { activeLeadCount: 1 }), cand('c', { activeLeadCount: 3 })];
    expect(selectAssignee({ strategy: 'least_loaded' }, pool)).toBe('b');
  });

  it('respects max_active_leads (full agents excluded)', () => {
    const pool = [cand('a', { activeLeadCount: 100, maxActiveLeads: 100 }), cand('b', { activeLeadCount: 2 })];
    expect(selectAssignee({ strategy: 'least_loaded' }, pool)).toBe('b');
  });

  it('filters by required language skill', () => {
    const pool = [cand('a', { languages: ['en'] }), cand('b', { languages: ['en', 'hi'] })];
    expect(selectAssignee({ strategy: 'round_robin', requireLanguage: 'hi' }, pool, 0)).toBe('b');
  });

  it('specific_user returns that user (or null if unknown)', () => {
    const pool = [cand('a'), cand('b')];
    expect(selectAssignee({ strategy: 'specific_user', userId: 'b' }, pool)).toBe('b');
    expect(selectAssignee({ strategy: 'specific_user', userId: 'z' }, pool)).toBeNull();
  });

  it('returns null when nobody is available', () => {
    const pool = [cand('a', { activeLeadCount: 100, maxActiveLeads: 100 })];
    expect(selectAssignee({ strategy: 'round_robin' }, pool, 0)).toBeNull();
  });
});
