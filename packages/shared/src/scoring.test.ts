import { describe, it, expect } from 'vitest';
import { computeScore, DEFAULT_WEIGHTS } from './scoring';
import { emptyQualification } from './qualification';

function q(overrides: Partial<ReturnType<typeof emptyQualification>>) {
  return { ...emptyQualification(), ...overrides };
}

describe('computeScore', () => {
  it('spam intent scores 0 (COLD)', () => {
    const r = computeScore({ qualification: q({ intent: 'spam' }) });
    expect(r.score).toBe(0);
    expect(r.tier).toBe('COLD');
    expect(r.reasons[0].factor).toBe('spam');
  });

  it('a hot, complete lead scores high', () => {
    const r = computeScore({
      qualification: q({
        intent: 'buy',
        bhk: 2,
        budget_min: 6000000,
        budget_max: 8000000,
        locations: ['Wakad'],
        timeline: '0-3m',
        financing: 'loan',
        site_visit_interest: true,
      }),
      inboundCount: 6,
      inventoryFit: 0.9,
      source: 'REFERRAL',
    });
    expect(r.score).toBeGreaterThanOrEqual(70);
    expect(r.tier).toBe('HOT');
  });

  it('a bare browsing lead scores low (COLD)', () => {
    const r = computeScore({ qualification: q({ intent: 'browsing' }), inboundCount: 0 });
    expect(r.score).toBeLessThan(40);
    expect(r.tier).toBe('COLD');
  });

  it('missing fields reduce completeness points', () => {
    const full = computeScore({
      qualification: q({ intent: 'buy', bhk: 2, budget_max: 8000000, locations: ['Baner'], timeline: '0-3m', financing: 'cash' }),
    });
    const sparse = computeScore({ qualification: q({ intent: 'buy' }) });
    const fullC = full.reasons.find((x) => x.factor === 'completeness')!.points;
    const sparseC = sparse.reasons.find((x) => x.factor === 'completeness')!.points;
    expect(fullC).toBeGreaterThan(sparseC);
  });

  it('cold decay subtracts points when quiet', () => {
    const base = computeScore({ qualification: q({ intent: 'buy', budget_max: 8000000, timeline: '0-3m' }), daysSinceLastInbound: 0 });
    const decayed = computeScore({ qualification: q({ intent: 'buy', budget_max: 8000000, timeline: '0-3m' }), daysSinceLastInbound: 10 });
    expect(decayed.score).toBeLessThan(base.score);
    expect(decayed.reasons.some((r) => r.factor === 'decay')).toBe(true);
  });

  it('decay is capped at -20', () => {
    const r = computeScore({ qualification: q({ intent: 'buy' }), daysSinceLastInbound: 100 });
    const decay = r.reasons.find((x) => x.factor === 'decay')!;
    expect(decay.points).toBe(-20);
  });

  it('is deterministic for the same input', () => {
    const input = { qualification: q({ intent: 'buy', bhk: 3, budget_max: 12000000, timeline: '3-6m' }), inboundCount: 3 };
    expect(computeScore(input).score).toBe(computeScore(input).score);
  });

  it('respects tenant weight overrides', () => {
    const base = q({ intent: 'buy', site_visit_interest: true, budget_max: 8000000 });
    const normal = computeScore({ qualification: base });
    const noVisitWeight = computeScore({ qualification: base }, { ...DEFAULT_WEIGHTS, siteVisitInterest: 0 });
    expect(noVisitWeight.score).toBeLessThan(normal.score);
  });

  it('never exceeds 100 or drops below 0', () => {
    const max = computeScore({
      qualification: q({ intent: 'buy', bhk: 2, budget_max: 9000000, locations: ['Wakad'], timeline: '0-3m', financing: 'loan', site_visit_interest: true }),
      inboundCount: 50,
      inventoryFit: 1,
      source: 'REFERRAL',
    });
    expect(max.score).toBeLessThanOrEqual(100);
    const min = computeScore({ qualification: q({ intent: 'browsing' }), daysSinceLastInbound: 999 });
    expect(min.score).toBeGreaterThanOrEqual(0);
  });
});
