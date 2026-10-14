import { describe, it, expect } from 'vitest';
import { MockLlmProvider } from './llm-mock';
import { coerceQualification, estimateCostMicroUsd } from '../llm';
import { QualificationSchema } from '../qualification';

const llm = new MockLlmProvider();

describe('coerceQualification', () => {
  it('parses fenced JSON from an LLM', () => {
    const raw = '```json\n{"intent":"buy","bhk":2,"locations":["Wakad"],"confidence":0.8}\n```';
    const q = coerceQualification(raw);
    expect(q.intent).toBe('buy');
    expect(q.bhk).toBe(2);
    expect(q.locations).toEqual(['Wakad']);
  });

  it('extracts the first JSON block from noisy text', () => {
    const q = coerceQualification('Here you go: {"intent":"rent"} hope that helps');
    expect(q.intent).toBe('rent');
  });

  it('throws on non-JSON', () => {
    expect(() => coerceQualification('not json at all')).toThrow();
  });
});

describe('estimateCostMicroUsd', () => {
  it('is zero for zero tokens and positive otherwise', () => {
    expect(estimateCostMicroUsd(0, 0)).toBe(0);
    expect(estimateCostMicroUsd(1000, 1000)).toBeGreaterThan(0);
  });
});

/**
 * Golden-set: English + Hinglish samples. Against the MockLlmProvider these run
 * deterministically everywhere; the same cases can be pointed at the real
 * Gemini API by swapping the provider.
 */
const GOLDEN: { msg: string; expect: Partial<Record<string, unknown>> }[] = [
  { msg: '2bhk chahiye wakad me 70 lakh tak, 3 mahine me', expect: { intent: 'buy', bhk: 2, timeline: '0-3m' } },
  { msg: 'Looking for a 3 BHK in Baner, budget 1.2 cr, home loan', expect: { intent: 'buy', bhk: 3, financing: 'loan' } },
  { msg: 'rent chahiye hinjewadi me', expect: { intent: 'rent' } },
  { msg: 'investment ke liye flat dekhna hai', expect: { intent: 'invest', site_visit_interest: true } },
  { msg: 'price kya hai is project ka?', expect: { urgency_signals: ['asked about price'] } },
  { msg: 'bitcoin crypto click here http://spam', expect: { intent: 'spam' } },
];

describe('MockLlmProvider.extract (golden-set)', () => {
  for (const [i, c] of GOLDEN.entries()) {
    it(`case ${i + 1}: "${c.msg.slice(0, 30)}…"`, async () => {
      const { qualification, usage } = await llm.extract({ conversation: c.msg });
      // Always schema-valid.
      expect(() => QualificationSchema.parse(qualification)).not.toThrow();
      for (const [k, v] of Object.entries(c.expect)) {
        expect(qualification[k as keyof typeof qualification]).toEqual(v);
      }
      expect(usage.totalTokens).toBeGreaterThan(0);
    });
  }
});
