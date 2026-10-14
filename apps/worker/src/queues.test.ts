import { describe, it, expect } from 'vitest';
import { QUEUES, DEFAULT_JOB_OPTIONS } from './queues';

describe('queue config', () => {
  it('defines all pipeline queues from PRD §6', () => {
    expect(Object.values(QUEUES)).toContain('inbound.message');
    expect(Object.values(QUEUES)).toContain('ai.process');
    expect(Object.values(QUEUES)).toContain('sla.escalation');
    expect(Object.values(QUEUES)).toHaveLength(8);
  });

  it('retries with exponential backoff and keeps failed jobs for the DLQ', () => {
    expect(DEFAULT_JOB_OPTIONS.attempts).toBeGreaterThanOrEqual(3);
    expect(DEFAULT_JOB_OPTIONS.backoff.type).toBe('exponential');
    expect(DEFAULT_JOB_OPTIONS.removeOnFail).toBe(false);
  });
});
