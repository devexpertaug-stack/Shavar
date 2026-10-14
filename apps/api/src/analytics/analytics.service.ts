import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@estateflow/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Headline KPIs (PRD §4.10 / FR-25). */
  async overview(tenantId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const [totalLeads, byTier, bySource, llm, aiMsgs, humanMsgs] = await Promise.all([
        tx.lead.count(),
        tx.lead.groupBy({ by: ['tier'], _count: true }),
        tx.lead.groupBy({ by: ['source'], _count: true }),
        tx.llmUsage.aggregate({ _sum: { totalTokens: true, costMicroUsd: true } }),
        tx.message.count({ where: { direction: 'OUTBOUND', sentBy: 'ai' } }),
        tx.message.count({ where: { direction: 'OUTBOUND', sentBy: 'user' } }),
      ]);
      const aiResolutionRate = aiMsgs + humanMsgs > 0 ? aiMsgs / (aiMsgs + humanMsgs) : 0;
      return {
        totalLeads,
        byTier: Object.fromEntries(byTier.map((t) => [t.tier, t._count])),
        bySource: Object.fromEntries(bySource.map((s) => [s.source, s._count])),
        llm: {
          totalTokens: llm._sum.totalTokens ?? 0,
          costUsd: (llm._sum.costMicroUsd ?? 0) / 1_000_000,
        },
        aiVsHuman: { ai: aiMsgs, human: humanMsgs, aiResolutionRate },
      };
    });
  }

  /** Pipeline funnel: lead count per stage (FR-25). */
  async funnel(tenantId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const stages = await tx.pipelineStage.findMany({ orderBy: { order: 'asc' } });
      const counts = await tx.lead.groupBy({ by: ['stage'], _count: true });
      const map = Object.fromEntries(counts.map((c) => [c.stage, c._count]));
      return stages.map((s) => ({ stage: s.name, count: map[s.name] ?? 0 }));
    });
  }

  /** Agent leaderboard: calls, connects, visits, bookings (FR-25). */
  async agents(tenantId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const users = await tx.user.findMany({ where: { role: { in: ['TELE_CALLER', 'SALES_MANAGER', 'FIELD_AGENT'] } } });
      const rows = [];
      for (const u of users) {
        const [calls, connects, bookings, assigned] = await Promise.all([
          tx.call.count({ where: { userId: u.id } }),
          tx.call.count({ where: { userId: u.id, outcome: 'connected' } }),
          tx.call.count({ where: { userId: u.id, outcome: 'visit_booked' } }),
          tx.lead.count({ where: { assignedTo: u.id } }),
        ]);
        rows.push({ userId: u.id, name: u.name, role: u.role, calls, connects, bookings, assigned });
      }
      return rows.sort((a, b) => b.bookings - a.bookings || b.connects - a.connects);
    });
  }

  /** Source ROI: leads + bookings per source (cost per lead = adSpend/leads). */
  async sources(tenantId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const leadsBySource = await tx.lead.groupBy({ by: ['source'], _count: true });
      const booked = await tx.lead.groupBy({ by: ['source'], where: { stage: 'Booked' }, _count: true });
      const bookedMap = Object.fromEntries(booked.map((b) => [b.source, b._count]));
      const settings = (await tx.tenant.findUnique({ where: { id: tenantId } }))?.settings as
        | { adSpend?: Record<string, number> }
        | undefined;
      const adSpend = settings?.adSpend ?? {};
      return leadsBySource.map((s) => {
        const leads = s._count;
        const spend = adSpend[s.source] ?? 0;
        return {
          source: s.source,
          leads,
          bookings: bookedMap[s.source] ?? 0,
          adSpend: spend,
          costPerLead: leads > 0 ? spend / leads : 0,
        };
      });
    });
  }

  /** CSV export of leads — audit-logged (FR-26 / §5). */
  async exportLeadsCsv(user: AuthUser): Promise<string> {
    return this.prisma.withTenant(user.tenantId, async (tx) => {
      const leads = await tx.lead.findMany({ include: { contact: true }, orderBy: { createdAt: 'desc' } });
      await tx.auditLog.create({
        data: { tenantId: user.tenantId, userId: user.id, action: 'export', target: 'leads', metadata: { count: leads.length } },
      });
      const header = 'id,name,phone,source,stage,tier,score,createdAt';
      const rows = leads.map((l) =>
        [l.id, l.contact.name ?? '', l.contact.phoneE164, l.source, l.stage, l.tier, l.score, l.createdAt.toISOString()].join(','),
      );
      return [header, ...rows].join('\n');
    });
  }

  /** Realtime-ish activity feed (recent activities across the tenant). */
  async feed(tenantId: string) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.activity.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
    );
  }
}
