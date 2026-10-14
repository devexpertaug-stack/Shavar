import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the prisma module so processInbound runs against an in-memory fake.
const state = {
  messages: new Map<string, { id: string; leadId: string; providerMessageId: string | null }>(),
  contacts: new Map<string, { id: string; phoneE164: string }>(),
  leads: [] as { id: string; contactId: string }[],
  activities: [] as unknown[],
};

const tx = {
  message: {
    findUnique: vi.fn(async ({ where }: { where: { tenantId_providerMessageId: { providerMessageId: string } } }) => {
      const pid = where.tenantId_providerMessageId.providerMessageId;
      for (const m of state.messages.values()) if (m.providerMessageId === pid) return m;
      return null;
    }),
    create: vi.fn(async ({ data }: { data: { leadId: string; providerMessageId: string | null } }) => {
      const id = `msg_${state.messages.size + 1}`;
      const row = { id, leadId: data.leadId, providerMessageId: data.providerMessageId };
      state.messages.set(id, row);
      return row;
    }),
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
  contact: {
    upsert: vi.fn(async ({ where }: { where: { tenantId_phoneE164: { phoneE164: string } } }) => {
      const phone = where.tenantId_phoneE164.phoneE164;
      let c = state.contacts.get(phone);
      if (!c) {
        c = { id: `contact_${state.contacts.size + 1}`, phoneE164: phone };
        state.contacts.set(phone, c);
      }
      return c;
    }),
  },
  lead: {
    findFirst: vi.fn(async ({ where }: { where: { contactId: string } }) =>
      state.leads.find((l) => l.contactId === where.contactId) ?? null,
    ),
    create: vi.fn(async ({ data }: { data: { contactId: string } }) => {
      const lead = { id: `lead_${state.leads.length + 1}`, contactId: data.contactId };
      state.leads.push(lead);
      return lead;
    }),
    update: vi.fn(async () => ({})),
  },
  activity: { create: vi.fn(async (a: unknown) => { state.activities.push(a); return {}; }) },
  campaignRecipient: { updateMany: vi.fn(async () => ({ count: 0 })) },
};

vi.mock('../prisma', () => ({
  withTenant: (_t: string, fn: (tx: unknown) => Promise<unknown>) => fn(tx),
  prisma: {},
}));

// Avoid the real BullMQ producer (and its Redis connection) in unit tests.
const enqueueMock = vi.fn(async () => ({ id: 'job' }));
vi.mock('../producer', () => ({
  enqueue: (...args: unknown[]) => enqueueMock(...args),
  QUEUES: { AI: 'ai.process' },
}));

import { processInbound } from './inbound';

const redis = { publish: vi.fn(async () => 1) } as unknown as import('ioredis').default;

function msgJob(providerMessageId: string, text = 'hello') {
  return {
    name: 'message',
    data: {
      tenantId: '00000000-0000-0000-0000-0000000000aa',
      providerType: 'MOCK',
      message: {
        providerMessageId,
        from: '919812345678',
        type: 'text',
        text,
        timestamp: new Date().toISOString(),
        contactName: 'Rohit',
      },
    },
  } as unknown as import('bullmq').Job;
}

describe('processInbound', () => {
  beforeEach(() => {
    state.messages.clear();
    state.contacts.clear();
    state.leads = [];
    state.activities = [];
    vi.clearAllMocks();
  });

  it('creates a contact, lead, and message on first delivery', async () => {
    await processInbound(msgJob('wamid.1'), redis);
    expect(state.contacts.size).toBe(1);
    expect(state.leads.length).toBe(1);
    expect(state.messages.size).toBe(1);
    expect(redis.publish).toHaveBeenCalledTimes(1); // realtime push
  });

  it('is idempotent: the same providerMessageId delivered twice stores one message', async () => {
    await processInbound(msgJob('wamid.dup'), redis);
    await processInbound(msgJob('wamid.dup'), redis);
    expect(state.messages.size).toBe(1);
    // Second delivery was a no-op => only one realtime publish.
    expect(redis.publish).toHaveBeenCalledTimes(1);
  });

  it('reuses the existing lead for a second (distinct) message from the same contact', async () => {
    await processInbound(msgJob('wamid.a'), redis);
    await processInbound(msgJob('wamid.b', 'second'), redis);
    expect(state.leads.length).toBe(1);
    expect(state.messages.size).toBe(2);
  });

  it('updates status for a status job without creating a message', async () => {
    const statusJob = {
      name: 'status',
      data: {
        tenantId: '00000000-0000-0000-0000-0000000000aa',
        status: { providerMessageId: 'wamid.x', status: 'delivered', timestamp: new Date().toISOString() },
      },
    } as unknown as import('bullmq').Job;
    const res = await processInbound(statusJob, redis);
    expect(res.ok).toBe(true);
    expect(tx.message.updateMany).toHaveBeenCalled();
  });
});
