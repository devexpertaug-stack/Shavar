import { describe, it, expect } from 'vitest';
import { leadMatchesSegment, rateLimitBatch, type SegmentLead } from './segments';
import { emptyQualification } from './qualification';

function lead(o: Partial<SegmentLead> = {}): SegmentLead {
  return {
    tier: 'WARM',
    stage: 'Contacted',
    optedIn: true,
    qualification: { ...emptyQualification(), locations: ['Wakad'], budget_min: 6000000, budget_max: 8000000 },
    ...o,
  };
}

describe('leadMatchesSegment', () => {
  it('matches on tier + location', () => {
    expect(leadMatchesSegment(lead(), { tier: 'WARM', location: 'Wakad' })).toBe(true);
  });
  it('excludes opted-out leads regardless of match', () => {
    expect(leadMatchesSegment(lead({ optedIn: false }), { tier: 'WARM' })).toBe(false);
  });
  it('rejects a tier mismatch', () => {
    expect(leadMatchesSegment(lead({ tier: 'COLD' }), { tier: 'HOT' })).toBe(false);
  });
  it('rejects a location mismatch', () => {
    expect(leadMatchesSegment(lead(), { location: 'Baner' })).toBe(false);
  });
  it('filters by budget window', () => {
    expect(leadMatchesSegment(lead(), { budgetMin: 7000000 })).toBe(true);
    expect(leadMatchesSegment(lead(), { budgetMin: 9000000 })).toBe(false);
  });
  it('empty segment matches any opted-in lead', () => {
    expect(leadMatchesSegment(lead(), {})).toBe(true);
  });
});

describe('rateLimitBatch', () => {
  it('caps the immediate batch and defers the rest', () => {
    expect(rateLimitBatch(250, 100)).toEqual({ now: 100, deferred: 150 });
    expect(rateLimitBatch(40, 100)).toEqual({ now: 40, deferred: 0 });
  });
});
