import { Injectable } from '@nestjs/common';
import {
  computeScore,
  tierForScore,
  DEFAULT_WEIGHTS,
  type ScoringWeights,
  type Qualification,
} from '@estateflow/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ScoringService {
  constructor(private readonly prisma: PrismaService) {}

  async getWeights(tenantId: string): Promise<ScoringWeights> {
    const tenant = await this.prisma.withTenant(tenantId, (tx) =>
      tx.tenant.findUnique({ where: { id: tenantId } }),
    );
    const w = (tenant?.scoringWeights ?? {}) as Partial<ScoringWeights>;
    return { ...DEFAULT_WEIGHTS, ...w };
  }

  async setWeights(tenantId: string, weights: Partial<ScoringWeights>): Promise<ScoringWeights> {
    const merged = { ...DEFAULT_WEIGHTS, ...weights };
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.tenant.update({ where: { id: tenantId }, data: { scoringWeights: merged } }),
    );
    return merged;
  }

  /**
   * Nightly decay (FR §4.3): rescore every active lead so quiet leads lose
   * points over time. Records a ScoreEvent whenever the score changes.
   */
  async decayAll(tenantId: string): Promise<{ rescored: number; changed: number }> {
    const weights = await this.getWeights(tenantId);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const leads = await tx.lead.findMany({ where: { stage: { notIn: ['Booked', 'Lost'] } } });
      let changed = 0;
      for (const lead of leads) {
        const inboundCount = await tx.message.count({
          where: { leadId: lead.id, direction: 'INBOUND' },
        });
        const daysSinceLastInbound = lead.lastInboundAt
          ? Math.floor((Date.now() - new Date(lead.lastInboundAt).getTime()) / 86_400_000)
          : 0;
        const result = computeScore(
          {
            qualification: lead.qualification as unknown as Qualification,
            inboundCount,
            source: lead.source,
            daysSinceLastInbound,
          },
          weights,
        );
        if (result.score !== lead.score) {
          await tx.lead.update({
            where: { id: lead.id },
            data: { score: result.score, tier: tierForScore(result.score) },
          });
          await tx.scoreEvent.create({
            data: {
              tenantId,
              leadId: lead.id,
              oldScore: lead.score,
              newScore: result.score,
              reasons: result.reasons as unknown as object,
            },
          });
          changed++;
        }
      }
      return { rescored: leads.length, changed };
    });
  }
}
