import { z } from 'zod';
import type { Qualification } from './qualification';

/**
 * Campaign segment filter (PRD §4.9 / FR-22). Pure matcher so segment logic is
 * testable; the API builds an equivalent Prisma where-clause for efficiency and
 * uses this to double-check opt-out exclusion.
 */
export const SegmentSchema = z.object({
  tier: z.enum(['HOT', 'WARM', 'COLD']).optional(),
  stage: z.string().optional(),
  location: z.string().optional(),
  budgetMin: z.number().optional(),
  budgetMax: z.number().optional(),
});
export type Segment = z.infer<typeof SegmentSchema>;

export interface SegmentLead {
  tier: string;
  stage: string;
  optedIn: boolean;
  qualification: Qualification;
}

/** True if the lead matches the segment AND is opted in (never message opt-outs). */
export function leadMatchesSegment(lead: SegmentLead, seg: Segment): boolean {
  if (!lead.optedIn) return false; // opt-out exclusion (FR-23)
  if (seg.tier && lead.tier !== seg.tier) return false;
  if (seg.stage && lead.stage !== seg.stage) return false;
  if (seg.location) {
    const locs = (lead.qualification.locations ?? []).map((l) => l.toLowerCase());
    if (!locs.includes(seg.location.toLowerCase())) return false;
  }
  if (seg.budgetMin != null && (lead.qualification.budget_max ?? 0) < seg.budgetMin) return false;
  if (seg.budgetMax != null && (lead.qualification.budget_min ?? Infinity) > seg.budgetMax)
    return false;
  return true;
}

/**
 * Rate-limit a batch of sends: given a per-minute cap, return how many to send
 * now vs defer. Keeps broadcasts within provider limits (FR-23).
 */
export function rateLimitBatch(total: number, perMinute: number): { now: number; deferred: number } {
  const now = Math.min(total, perMinute);
  return { now, deferred: Math.max(0, total - now) };
}
