/**
 * Next Best Call ranking (PRD §4.5 / FR-13). Priority combines score, urgency,
 * time since last touch, and overdue follow-ups. Pure + tested; the caller
 * workspace sorts its queue by rankLead descending.
 */
export interface RankableLead {
  score: number; // 0..100
  tier: 'HOT' | 'WARM' | 'COLD';
  urgencySignals: number; // count of urgency signals extracted
  lastTouchAt: Date | string | null; // last outbound/call
  nextFollowupAt: Date | string | null;
}

export interface RankResult {
  priority: number;
  overdue: boolean;
}

const toTime = (v: Date | string | null): number | null => {
  if (!v) return null;
  const t = typeof v === 'string' ? new Date(v).getTime() : v.getTime();
  return Number.isNaN(t) ? null : t;
};

export function rankLead(lead: RankableLead, now: Date = new Date()): RankResult {
  const nowMs = now.getTime();

  // Base: score (0..100).
  let priority = lead.score;

  // Urgency multiplier from extracted signals (each adds 10%, capped +50%).
  priority *= 1 + Math.min(0.5, lead.urgencySignals * 0.1);

  // Time since last touch: never-touched leads and long-quiet ones rank higher.
  const last = toTime(lead.lastTouchAt);
  const hoursSinceTouch = last == null ? 72 : Math.max(0, (nowMs - last) / 3_600_000);
  priority += Math.min(40, hoursSinceTouch); // up to +40 over ~40h+

  // Overdue follow-ups jump to the top (big boost).
  const followup = toTime(lead.nextFollowupAt);
  const overdue = followup != null && followup <= nowMs;
  if (overdue) priority += 1000;

  return { priority: Math.round(priority), overdue };
}

/** Sort leads for the Next Best Call queue (highest priority first). */
export function rankQueue<T extends RankableLead>(leads: T[], now: Date = new Date()): T[] {
  return [...leads].sort((a, b) => rankLead(b, now).priority - rankLead(a, now).priority);
}

/** Valid tele-caller outcomes (FR-15). An outcome is mandatory per call. */
export const CALL_OUTCOMES = [
  'connected',
  'no_answer',
  'callback',
  'not_interested',
  'visit_booked',
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export function isValidOutcome(v: string): v is CallOutcome {
  return (CALL_OUTCOMES as readonly string[]).includes(v);
}
