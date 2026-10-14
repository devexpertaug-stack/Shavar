import { z } from 'zod';

/**
 * Routing rules engine (PRD §4.4 / FR-11). Rules are evaluated in priority
 * order; the first whose conditions all match wins and its action decides the
 * assignment. The matcher here is pure/testable; the DB-backed strategy
 * execution (round-robin, least-loaded) lives in the API service.
 */

export const RoutingConditionSchema = z.object({
  source: z.string().optional(),
  project: z.string().optional(),
  location: z.string().optional(),
  language: z.string().optional(),
  tier: z.enum(['HOT', 'WARM', 'COLD']).optional(),
});
export type RoutingCondition = z.infer<typeof RoutingConditionSchema>;

export const RoutingActionSchema = z.object({
  strategy: z.enum(['round_robin', 'least_loaded', 'specific_user', 'team']),
  userId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  // Optional language skill requirement the assignee must have.
  requireLanguage: z.string().optional(),
});
export type RoutingAction = z.infer<typeof RoutingActionSchema>;

export interface RoutingRule {
  id: string;
  priority: number;
  conditions: RoutingCondition;
  action: RoutingAction;
  isActive: boolean;
}

/** Facts about a lead used to evaluate rule conditions. */
export interface LeadRoutingFacts {
  source?: string | null;
  project?: string | null;
  locations?: string[];
  language?: string | null;
  tier?: string | null;
}

function conditionMatches(cond: RoutingCondition, facts: LeadRoutingFacts): boolean {
  if (cond.source && cond.source !== facts.source) return false;
  if (cond.project && cond.project !== facts.project) return false;
  if (cond.tier && cond.tier !== facts.tier) return false;
  if (cond.language && cond.language.toLowerCase() !== (facts.language ?? '').toLowerCase())
    return false;
  if (cond.location) {
    const locs = (facts.locations ?? []).map((l) => l.toLowerCase());
    if (!locs.includes(cond.location.toLowerCase())) return false;
  }
  return true;
}

/**
 * Return the first active rule (lowest priority number = highest precedence)
 * whose conditions match, or null if none match.
 */
export function matchRule(rules: RoutingRule[], facts: LeadRoutingFacts): RoutingRule | null {
  const sorted = [...rules]
    .filter((r) => r.isActive)
    .sort((a, b) => a.priority - b.priority);
  for (const rule of sorted) {
    if (conditionMatches(rule.conditions, facts)) return rule;
  }
  return null;
}

export interface Candidate {
  id: string;
  teamId: string | null;
  languages: string[];
  activeLeadCount: number;
  maxActiveLeads: number;
}

/**
 * Choose an assignee among candidates per the action strategy. Honors
 * max_active_leads and an optional language-skill requirement (FR-11).
 * roundRobinCursor lets the caller rotate fairly across invocations.
 */
export function selectAssignee(
  action: RoutingAction,
  candidates: Candidate[],
  roundRobinCursor = 0,
): string | null {
  let pool = candidates.filter((c) => c.activeLeadCount < c.maxActiveLeads);
  if (action.requireLanguage) {
    const lang = action.requireLanguage.toLowerCase();
    pool = pool.filter((c) => c.languages.map((l) => l.toLowerCase()).includes(lang));
  }
  if (action.teamId) pool = pool.filter((c) => c.teamId === action.teamId);

  if (action.strategy === 'specific_user') {
    const found = candidates.find((c) => c.id === action.userId);
    return found ? found.id : null;
  }
  if (pool.length === 0) return null;

  if (action.strategy === 'least_loaded') {
    return [...pool].sort((a, b) => a.activeLeadCount - b.activeLeadCount)[0].id;
  }
  // round_robin / team default: rotate by cursor over a stable ordering.
  const ordered = [...pool].sort((a, b) => a.id.localeCompare(b.id));
  return ordered[roundRobinCursor % ordered.length].id;
}
