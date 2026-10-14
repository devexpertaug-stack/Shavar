import { LOST_STAGE } from '@estateflow/shared';

export interface StageTransitionInput {
  from: string;
  to: string;
  lostReason?: string;
  validStages: string[];
}

export interface StageTransitionResult {
  ok: boolean;
  error?: string;
}

/**
 * Pure validation for a stage change (FR-20):
 *  - the target stage must exist in the tenant pipeline
 *  - moving to "Lost" requires a non-empty reason
 *
 * Kept pure so it is exhaustively unit-testable without a DB.
 */
export function validateStageTransition(input: StageTransitionInput): StageTransitionResult {
  const { from, to, lostReason, validStages } = input;

  if (!validStages.includes(to)) {
    return { ok: false, error: `Unknown stage "${to}"` };
  }
  if (to === LOST_STAGE && (!lostReason || lostReason.trim().length === 0)) {
    return { ok: false, error: 'A reason is required when marking a lead as Lost' };
  }
  if (from === to) {
    return { ok: false, error: `Lead is already in stage "${to}"` };
  }
  return { ok: true };
}
