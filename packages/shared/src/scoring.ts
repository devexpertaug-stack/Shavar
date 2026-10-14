import type { Qualification } from './qualification';
import { tierForScore, type Tier } from './enums';

/**
 * Deterministic, explainable lead scoring (PRD §4.3 / FR-9). The LLM only
 * extracts fields; the SCORE is computed here in code so it is testable and
 * every point is explainable. Weights are tenant-configurable.
 */
export interface ScoringWeights {
  budgetFit: number; // budget fits inventory
  timeline: number; // sooner = better
  engagement: number; // message count / recency
  siteVisitInterest: number;
  completeness: number; // how many fields are known
  sourceQuality: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  budgetFit: 25,
  timeline: 20,
  engagement: 20,
  siteVisitInterest: 15,
  completeness: 10,
  sourceQuality: 10,
};

export interface ScoringSignals {
  qualification: Qualification;
  /** Number of inbound messages from the lead (engagement proxy). */
  inboundCount?: number;
  /** 0..1 how well the budget matches available inventory (Task 9 feeds this). */
  inventoryFit?: number | null;
  /** Lead source, for source-quality weighting. */
  source?: string;
  /** Days since the last inbound message (drives decay). */
  daysSinceLastInbound?: number;
}

export interface ScoreReason {
  factor: keyof ScoringWeights | 'decay' | 'spam';
  points: number;
  detail: string;
}

export interface ScoreResult {
  score: number; // 0..100 integer
  tier: Tier;
  reasons: ScoreReason[];
}

const SOURCE_QUALITY: Record<string, number> = {
  REFERRAL: 1,
  WEBSITE: 0.9,
  META_LEAD_ADS: 0.8,
  WHATSAPP: 0.8,
  NINETY_NINE_ACRES: 0.7,
  MAGICBRICKS: 0.7,
  HOUSING: 0.7,
  MANUAL: 0.6,
};

const TIMELINE_FACTOR: Record<string, number> = {
  '0-3m': 1,
  '3-6m': 0.6,
  '6m+': 0.3,
  unknown: 0.1,
};

/**
 * Compute a 0–100 score with per-factor reasons. Spam intent short-circuits to
 * 0. Cold decay subtracts points as the lead goes quiet.
 */
export function computeScore(
  signals: ScoringSignals,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
): ScoreResult {
  const q = signals.qualification;
  const reasons: ScoreReason[] = [];

  if (q.intent === 'spam') {
    return { score: 0, tier: 'COLD', reasons: [{ factor: 'spam', points: 0, detail: 'Spam intent' }] };
  }

  const add = (factor: keyof ScoringWeights, factor01: number, detail: string) => {
    const points = Math.round(weights[factor] * clamp01(factor01));
    reasons.push({ factor, points, detail });
    return points;
  };

  let score = 0;

  // Budget fit: use inventoryFit if provided, else a heuristic from having a budget.
  const budgetFit01 =
    signals.inventoryFit != null ? signals.inventoryFit : q.budget_max ? 0.7 : 0.1;
  score += add('budgetFit', budgetFit01, `Budget fit ${(budgetFit01 * 100) | 0}%`);

  score += add('timeline', TIMELINE_FACTOR[q.timeline] ?? 0.1, `Timeline ${q.timeline}`);

  const engagement01 = Math.min(1, (signals.inboundCount ?? 0) / 5);
  score += add('engagement', engagement01, `${signals.inboundCount ?? 0} inbound message(s)`);

  score += add('siteVisitInterest', q.site_visit_interest ? 1 : 0, q.site_visit_interest ? 'Wants a site visit' : 'No visit interest yet');

  const completeness01 = fieldCompleteness(q);
  score += add('completeness', completeness01, `${Math.round(completeness01 * 100)}% of fields known`);

  const sourceQ = SOURCE_QUALITY[signals.source ?? 'MANUAL'] ?? 0.6;
  score += add('sourceQuality', sourceQ, `Source ${signals.source ?? 'MANUAL'}`);

  // Cold decay: -3 points/day beyond 3 days quiet, capped at -20.
  const days = signals.daysSinceLastInbound ?? 0;
  if (days > 3) {
    const penalty = Math.min(20, Math.round((days - 3) * 3));
    score -= penalty;
    reasons.push({ factor: 'decay', points: -penalty, detail: `Quiet for ${days} days` });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, tier: tierForScore(score), reasons };
}

function fieldCompleteness(q: Qualification): number {
  const fields = [
    q.intent !== 'browsing',
    q.bhk != null,
    q.budget_max != null,
    q.locations.length > 0,
    q.timeline !== 'unknown',
    q.financing !== 'unknown',
  ];
  return fields.filter(Boolean).length / fields.length;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
