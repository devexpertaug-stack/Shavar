import { describe, it, expect } from 'vitest';
import { validateStageTransition } from './stage-transition';
import { DEFAULT_STAGES } from '@estateflow/shared';

const validStages = [...DEFAULT_STAGES];

describe('validateStageTransition', () => {
  it('allows a normal forward transition', () => {
    expect(
      validateStageTransition({ from: 'New', to: 'Contacted', validStages }),
    ).toEqual({ ok: true });
  });

  it('rejects an unknown target stage', () => {
    const r = validateStageTransition({ from: 'New', to: 'Nope', validStages });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Unknown stage/);
  });

  it('requires a reason when moving to Lost', () => {
    const r = validateStageTransition({ from: 'Negotiation', to: 'Lost', validStages });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/reason is required/i);
  });

  it('rejects a whitespace-only lost reason', () => {
    const r = validateStageTransition({
      from: 'Negotiation',
      to: 'Lost',
      lostReason: '   ',
      validStages,
    });
    expect(r.ok).toBe(false);
  });

  it('allows Lost with a reason', () => {
    expect(
      validateStageTransition({
        from: 'Negotiation',
        to: 'Lost',
        lostReason: 'Budget too low',
        validStages,
      }),
    ).toEqual({ ok: true });
  });

  it('rejects a no-op transition to the same stage', () => {
    const r = validateStageTransition({ from: 'New', to: 'New', validStages });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/already in stage/);
  });
});
