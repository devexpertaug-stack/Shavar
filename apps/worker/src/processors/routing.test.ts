import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = {
  lead: null as Record<string, unknown> | null,
  users: [] as Record<string, unknown>[],
  routingRules: [] as Record<string, unknown>[],
  tenant: { id: 't', routingCursor: 0 },
  assignments: [] as (string | null)[],
  notifications: [] as Record<string, unknown>[],
};

const tx = {
  lead: {
    findUnique: vi.fn(async () => db.lead),
    update: vi.fn(async ({ data }: { data: { assignedTo: string | null } }) => {
      db.assignments.push(data.assignedTo);
      if (db.lead) db.lead.assignedTo = data.assignedTo;
      return {};
    }),
    count: vi.fn(async () => 0),
  },
  routingRule: { findMany: vi.fn(async () => db.routingRules) },
  user: {
    findMany: vi.fn(async () => db.users),
    findFirst: vi.fn(async () => db.users.find((u) => u.role === 'SALES_MANAGER') ?? null),
  },
  tenant: {
    findUnique: vi.fn(async () => db.tenant),
    update: vi.fn(async () => ({})),
  },
  activity: { create: vi.fn(async () => ({})), count: vi.fn(async () => 0) },
  notification: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      db.notifications.push(data);
      return {};
    }),
  },
  message: { count: vi.fn(async () => 0) },
};

vi.mock('../prisma', () => ({
  withTenant: (_t: string, fn: (tx: unknown) => Promise<unknown>) => fn(tx),
  prisma: {},
}));
const enqueueMock = vi.fn(async () => ({ id: 'job' }));
vi.mock('../producer', () => ({
  enqueue: (...a: unknown[]) => enqueueMock(...a),
  QUEUES: { SLA: 'sla.escalation' },
}));

import { processRouting } from './routing';
import { processSla } from './sla';

const redis = { publish: vi.fn(async () => 1) } as unknown as import('ioredis').default;

function routeJob() {
  return { name: 'assign', data: { tenantId: 't', leadId: 'lead_1' } } as unknown as import('bullmq').Job;
}

describe('processRouting', () => {
  beforeEach(() => {
    db.lead = {
      id: 'lead_1',
      assignedTo: null,
      source: 'WEBSITE',
      tier: 'HOT',
      qualification: { locations: ['Wakad'] },
      contact: { language: 'hi', name: 'Rohit', phoneE164: '+919812345678' },
    };
    db.users = [
      { id: 'u-hi', teamId: null, languages: ['en', 'hi'], maxActiveLeads: 100, role: 'TELE_CALLER' },
      { id: 'u-en', teamId: null, languages: ['en'], maxActiveLeads: 100, role: 'TELE_CALLER' },
    ];
    db.routingRules = [
      { id: 'r1', priority: 1, isActive: true, conditions: { tier: 'HOT' }, action: { strategy: 'round_robin', requireLanguage: 'hi' } },
    ];
    db.tenant = { id: 't', routingCursor: 0 };
    db.assignments = [];
    db.notifications = [];
    vi.clearAllMocks();
  });

  it('assigns a Hot Hindi lead to the Hindi-speaking caller and schedules SLA', async () => {
    await processRouting(routeJob(), redis);
    expect(db.assignments[0]).toBe('u-hi');
    expect(db.notifications[0].type).toBe('HOT_LEAD');
    // SLA check scheduled with a delay.
    expect(enqueueMock).toHaveBeenCalled();
  });

  it('does not route an already-assigned lead', async () => {
    db.lead!.assignedTo = 'someone';
    await processRouting(routeJob(), redis);
    expect(db.assignments).toHaveLength(0);
  });

  it('does nothing when no rule matches', async () => {
    db.routingRules = [
      { id: 'r1', priority: 1, isActive: true, conditions: { tier: 'COLD' }, action: { strategy: 'round_robin' } },
    ];
    await processRouting(routeJob(), redis);
    expect(db.assignments).toHaveLength(0);
  });
});

describe('processSla', () => {
  beforeEach(() => {
    db.notifications = [];
    db.assignments = [];
    vi.clearAllMocks();
  });

  it('escalates an uncontacted Hot lead to a manager', async () => {
    db.lead = { id: 'lead_1', assignedTo: 'u-hi' };
    db.users = [{ id: 'mgr', role: 'SALES_MANAGER' }];
    tx.message.count = vi.fn(async () => 0);
    tx.activity.create = vi.fn(async () => ({}));
    const slaJob = { name: 'check', data: { tenantId: 't', leadId: 'lead_1', assignedTo: 'u-hi' } } as unknown as import('bullmq').Job;
    // activity.count is used by sla; add it
    (tx as unknown as { activity: { count: () => Promise<number> } }).activity.count = async () => 0;
    await processSla(slaJob, redis);
    expect(db.assignments[0]).toBe('mgr');
    expect(db.notifications.some((n) => n.type === 'SLA_ESCALATION')).toBe(true);
  });

  it('does not escalate when the lead was already contacted', async () => {
    db.lead = { id: 'lead_1', assignedTo: 'u-hi' };
    tx.message.count = vi.fn(async () => 1); // contacted
    (tx as unknown as { activity: { count: () => Promise<number> } }).activity.count = async () => 0;
    const slaJob = { name: 'check', data: { tenantId: 't', leadId: 'lead_1', assignedTo: 'u-hi' } } as unknown as import('bullmq').Job;
    await processSla(slaJob, redis);
    expect(db.assignments).toHaveLength(0);
  });
});
