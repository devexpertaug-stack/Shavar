import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = {
  leadUpdates: [] as Record<string, unknown>[],
  usageRows: [] as Record<string, unknown>[],
};

const tx = {
  message: {
    findMany: vi.fn(async () => [
      { direction: 'INBOUND', type: 'text', body: '2bhk chahiye wakad me 70 lakh tak, 3 mahine me' },
    ]),
    count: vi.fn(async () => 2),
  },
  lead: {
    findUnique: vi.fn(async () => ({
      id: 'lead_1',
      score: 0,
      source: 'WHATSAPP',
      lastInboundAt: new Date(),
      qualification: {},
    })),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      state.leadUpdates.push(data);
      return {};
    }),
  },
  tenant: {
    findUnique: vi.fn(async () => ({ id: 'tenant', scoringWeights: {} })),
  },
  unit: {
    findMany: vi.fn(async () => []),
  },
  scoreEvent: {
    create: vi.fn(async () => ({})),
  },
  activity: {
    create: vi.fn(async () => ({})),
  },
  llmUsage: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      state.usageRows.push(data);
      return {};
    }),
  },
};

vi.mock('../prisma', () => ({
  withTenant: (_t: string, fn: (tx: unknown) => Promise<unknown>) => fn(tx),
  prisma: {},
}));

// Avoid the real BullMQ producer (Redis) when the AI step chains into routing.
vi.mock('../producer', () => ({
  enqueue: vi.fn(async () => ({ id: 'job' })),
  QUEUES: { ROUTING: 'routing.assign' },
}));

// Force the deterministic mock LLM.
delete process.env.GEMINI_API_KEY;
process.env.LLM_PROVIDER = 'mock';

import { processAi } from './ai';

const redis = { publish: vi.fn(async () => 1) } as unknown as import('ioredis').default;

function aiJob() {
  return {
    name: 'qualify',
    data: { tenantId: '00000000-0000-0000-0000-0000000000aa', leadId: 'lead_1' },
  } as unknown as import('bullmq').Job;
}

describe('processAi', () => {
  beforeEach(() => {
    state.leadUpdates = [];
    state.usageRows = [];
    vi.clearAllMocks();
  });

  it('extracts qualification and writes it to the lead', async () => {
    const res = await processAi(aiJob(), redis);
    expect(res.ok).toBe(true);
    expect(state.leadUpdates).toHaveLength(1);
    const q = state.leadUpdates[0].qualification as Record<string, unknown>;
    expect(q.intent).toBe('buy');
    expect(q.bhk).toBe(2);
    expect(q.timeline).toBe('0-3m');
  });

  it('logs LLM usage for cost accounting', async () => {
    await processAi(aiJob(), redis);
    expect(state.usageRows).toHaveLength(1);
    expect(state.usageRows[0].operation).toBe('extract');
    expect(Number(state.usageRows[0].totalTokens)).toBeGreaterThan(0);
  });

  it('publishes a realtime qualification event', async () => {
    await processAi(aiJob(), redis);
    expect(redis.publish).toHaveBeenCalledTimes(1);
  });
});
