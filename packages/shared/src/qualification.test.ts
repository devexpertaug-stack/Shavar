import { describe, it, expect } from 'vitest';
import { QualificationSchema, emptyQualification } from './qualification';
import { tierForScore } from './enums';

describe('QualificationSchema', () => {
  it('parses the PRD §4.3 example payload', () => {
    const parsed = QualificationSchema.parse({
      intent: 'buy',
      property_type: 'apartment',
      bhk: 2,
      budget_min: 6000000,
      budget_max: 8000000,
      locations: ['Wakad'],
      timeline: '0-3m',
      financing: 'loan',
      site_visit_interest: true,
      sentiment: 'pos',
      urgency_signals: ['asked for price twice'],
      next_question: 'What is your preferred possession date?',
      confidence: 0.82,
    });
    expect(parsed.bhk).toBe(2);
    expect(parsed.locations).toEqual(['Wakad']);
  });

  it('applies defaults for a minimal payload', () => {
    const parsed = QualificationSchema.parse({ intent: 'browsing' });
    expect(parsed.timeline).toBe('unknown');
    expect(parsed.financing).toBe('unknown');
    expect(parsed.locations).toEqual([]);
    expect(parsed.confidence).toBe(0);
  });

  it('rejects an invalid intent', () => {
    expect(() => QualificationSchema.parse({ intent: 'maybe' })).toThrow();
  });

  it('rejects confidence out of [0,1]', () => {
    expect(() => QualificationSchema.parse({ intent: 'buy', confidence: 1.5 })).toThrow();
  });

  it('produces a valid empty qualification', () => {
    const q = emptyQualification();
    expect(q.intent).toBe('browsing');
    expect(q.site_visit_interest).toBe(false);
  });
});

describe('tierForScore', () => {
  it('maps scores to tiers per FR-10', () => {
    expect(tierForScore(85)).toBe('HOT');
    expect(tierForScore(70)).toBe('HOT');
    expect(tierForScore(69)).toBe('WARM');
    expect(tierForScore(40)).toBe('WARM');
    expect(tierForScore(39)).toBe('COLD');
    expect(tierForScore(0)).toBe('COLD');
  });
});
