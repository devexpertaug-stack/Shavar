import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { type Segment } from '@estateflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService, QUEUES } from '../queue/queue.service';

/** Translate a segment filter into a Prisma where-clause (opted-in only). */
function segmentWhere(seg: Segment): Prisma.LeadWhereInput {
  const where: Prisma.LeadWhereInput = { contact: { optedIn: true } };
  if (seg.tier) where.tier = seg.tier;
  if (seg.stage) where.stage = seg.stage;
  return where;
}

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  list(tenantId: string) {
    return this.prisma.withTenant(tenantId, (tx) => tx.campaign.findMany({ orderBy: { createdAt: 'desc' } }));
  }

  /** Preview the audience size for a segment (opt-out excluded). */
  async preview(tenantId: string, seg: Segment) {
    return this.prisma.withTenant(tenantId, (tx) => tx.lead.count({ where: segmentWhere(seg) }));
  }

  async create(tenantId: string, body: { name: string; templateName: string; segment: Segment; scheduledAt?: string }) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.campaign.create({
        data: {
          tenantId,
          name: body.name,
          templateName: body.templateName,
          segment: body.segment,
          scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
          status: body.scheduledAt ? 'SCHEDULED' : 'DRAFT',
        },
      }),
    );
  }

  /**
   * Materialize recipients for a campaign's segment (opt-out excluded) and
   * enqueue the broadcast dispatch. Returns the recipient count.
   */
  async send(tenantId: string, campaignId: string): Promise<{ recipients: number }> {
    const count = await this.prisma.withTenant(tenantId, async (tx) => {
      const campaign = await tx.campaign.findUnique({ where: { id: campaignId } });
      if (!campaign) throw new NotFoundException('Campaign not found');
      const seg = campaign.segment as Segment;
      const leads = await tx.lead.findMany({ where: segmentWhere(seg), select: { id: true } });
      for (const l of leads) {
        await tx.campaignRecipient.upsert({
          where: { campaignId_leadId: { campaignId, leadId: l.id } },
          update: {},
          create: { tenantId, campaignId, leadId: l.id },
        });
      }
      await tx.campaign.update({ where: { id: campaignId }, data: { status: 'SENDING' } });
      return leads.length;
    });

    await this.queue.enqueue(QUEUES.CAMPAIGNS, 'broadcast', { tenantId, campaignId });
    return { recipients: count };
  }

  async stats(tenantId: string, campaignId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const recipients = await tx.campaignRecipient.groupBy({
        by: ['status'],
        where: { campaignId },
        _count: true,
      });
      return recipients.reduce<Record<string, number>>((acc, r) => {
        acc[r.status] = r._count;
        return acc;
      }, {});
    });
  }

  // --- sequences ---
  listSequences(tenantId: string) {
    return this.prisma.withTenant(tenantId, (tx) => tx.sequence.findMany({ orderBy: { createdAt: 'desc' } }));
  }

  createSequence(
    tenantId: string,
    body: { name: string; steps: { dayOffset: number; templateName: string }[]; segment: Segment },
  ) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.sequence.create({ data: { tenantId, name: body.name, steps: body.steps, segment: body.segment } }),
    );
  }
}
