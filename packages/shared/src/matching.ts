import type { Qualification } from './qualification';

/** Build the text we embed for a unit (used for vector similarity). */
export function unitEmbeddingText(u: {
  projectName: string;
  location: string;
  bhk: number;
  amenities?: string[];
  priceMin: number;
  priceMax: number;
}): string {
  return [
    `${u.bhk}BHK`,
    u.projectName,
    u.location,
    `price ${u.priceMin}-${u.priceMax}`,
    (u.amenities ?? []).join(' '),
  ].join(' ');
}

/** Build the query text for a lead's requirement (embedded for similarity). */
export function leadQueryText(q: Qualification): string {
  return [
    q.bhk ? `${q.bhk}BHK` : '',
    q.property_type ?? '',
    (q.locations ?? []).join(' '),
    q.budget_max ? `budget ${q.budget_min ?? 0}-${q.budget_max}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export interface HardFilterUnit {
  bhk: number;
  priceMin: number;
  priceMax: number;
  location: string;
  isAvailable: boolean;
}

/**
 * Hard filters (PRD §4.6): a unit qualifies if available, BHK matches (when
 * specified), price overlaps the lead budget, and location matches (when the
 * lead named locations). Pure + tested; vector ranking is applied on top.
 */
export function passesHardFilters(unit: HardFilterUnit, q: Qualification): boolean {
  if (!unit.isAvailable) return false;
  if (q.bhk != null && unit.bhk !== q.bhk) return false;
  if (q.budget_max != null) {
    // Budget overlaps unit price band (allow 10% stretch over budget).
    if (unit.priceMin > q.budget_max * 1.1) return false;
  }
  if (q.budget_min != null && unit.priceMax < q.budget_min * 0.9) return false;
  if (q.locations && q.locations.length > 0) {
    const locs = q.locations.map((l) => l.toLowerCase());
    if (!locs.includes(unit.location.toLowerCase())) return false;
  }
  return true;
}

/**
 * A simple 0..1 inventory-fit score for a lead given whether any unit matched,
 * fed into the deterministic lead score (Task 7). 0 = nothing fits.
 */
export function inventoryFitScore(matchCount: number): number {
  if (matchCount <= 0) return 0;
  if (matchCount >= 3) return 1;
  return 0.5 + matchCount * 0.15;
}
