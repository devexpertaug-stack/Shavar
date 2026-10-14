import { describe, it, expect } from 'vitest';
import { rankLead, rankQueue, isValidOutcome, type RankableLead } from './queue-ranking';

const now = new Date('2026-02-14T12:00:00Z');
function lead(o: Partial<RankableLead> = {}): RankableLead {
  return { score: 50, tier: 'WARM', urgencySignals: 0, lastTouchAt: null, nextFollowupAt: null, ...o };
}

describe('rankLead', () => {
  it('ranks a higher score above a lower one, all else equal', () => {
    const hi = rankLead(lead({ score: 80 }), now).priority;
    const lo = rankLead(lead({ score: 30 }), now).priority;
    expect(hi).toBeGreaterThan(lo);
  });

  it('urgency signals raise priority', () => {
    const base = rankLead(lead({ score: 50 }), now).priority;
    const urgent = rankLead(lead({ score: 50, urgencySignals: 3 }), now).priority;
    expect(urgent).toBeGreaterThan(base);
  });

  it('an overdue follow-up jumps to the top', () => {
    const overdue = rankLead(lead({ score: 10, nextFollowupAt: new Date('2026-02-14T10:00:00Z') }), now);
    const hotNoFollowup = rankLead(lead({ score: 100 }), now);
    expect(overdue.overdue).toBe(true);
    expect(overdue.priority).toBeGreaterThan(hotNoFollowup.priority);
  });

  it('leads not touched recently rank above freshly touched ones', () => {
    const stale = rankLead(lead({ score: 50, lastTouchAt: new Date('2026-02-13T12:00:00Z') }), now).priority;
    const fresh = rankLead(lead({ score: 50, lastTouchAt: new Date('2026-02-14T11:30:00Z') }), now).priority;
    expect(stale).toBeGreaterThan(fresh);
  });
});

describe('rankQueue', () => {
  it('sorts overdue first, then by combined priority', () => {
    const leads = [
      { id: 'a', ...lead({ score: 90 }) },
      { id: 'b', ...lead({ score: 20, nextFollowupAt: new Date('2026-02-14T09:00:00Z') }) },
      { id: 'c', ...lead({ score: 60 }) },
    ];
    const sorted = rankQueue(leads, now);
    expect(sorted[0].id).toBe('b'); // overdue wins
    expect(sorted[1].id).toBe('a'); // then highest score
  });
});

describe('isValidOutcome', () => {
  it('accepts valid outcomes and rejects others', () => {
    expect(isValidOutcome('connected')).toBe(true);
    expect(isValidOutcome('visit_booked')).toBe(true);
    expect(isValidOutcome('maybe')).toBe(false);
  });
});
