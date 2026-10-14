import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = { updates: [] as Record<string, unknown>[] };
const tx = {
  message: {
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      db.updates.push(data);
      return {};
    }),
  },
};
vi.mock('../prisma', () => ({
  withTenant: (_t: string, fn: (tx: unknown) => Promise<unknown>) => fn(tx),
  prisma: {},
}));
const enqueueMock = vi.fn(async () => ({ id: 'job' }));
vi.mock('../producer', () => ({ enqueue: (...a: unknown[]) => enqueueMock(...a), QUEUES: { AI: 'ai.process' } }));

process.env.STT_PROVIDER = 'mock';
delete process.env.GEMINI_API_KEY;

import { processMedia } from './media';

const redis = { publish: vi.fn(async () => 1) } as unknown as import('ioredis').default;

beforeEach(() => {
  db.updates = [];
  vi.clearAllMocks();
  // Stub fetch to return audio bytes.
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(8),
  })) as unknown as typeof fetch;
});

function job(over: Record<string, unknown> = {}) {
  return {
    name: 'transcribe',
    data: { tenantId: 't', leadId: 'lead_1', messageId: 'm1', mediaUrl: 'https://cdn/a.ogg', mimeType: 'audio/ogg', ...over },
  } as unknown as import('bullmq').Job;
}

describe('processMedia', () => {
  it('transcribes and stores the transcript, then triggers AI', async () => {
    await processMedia(job(), redis);
    expect(db.updates[0].transcript).toBeTruthy();
    expect(db.updates[0].body).toBe(db.updates[0].transcript);
    expect(enqueueMock).toHaveBeenCalledWith('ai.process', 'qualify', expect.anything());
  });

  it('falls back gracefully when the download fails', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    await processMedia(job(), redis);
    expect(String(db.updates[0].transcript)).toMatch(/voice note/);
  });

  it('handles a missing media URL without throwing', async () => {
    await processMedia(job({ mediaUrl: null }), redis);
    expect(db.updates).toHaveLength(1);
  });
});
