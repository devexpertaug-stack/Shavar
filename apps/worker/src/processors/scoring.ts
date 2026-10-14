import type { Job } from 'bullmq';
import {
  computeScore,
  tierForScore,
  DEFAULT_WEIGHTS,
  type ScoringWeights,
  type Qualification,
} from '@estateflow/shared';
import { prisma, withTenant } from '../prisma';
import { enqueue, QUEUES } from '../producer';
import { logger } from '../logger';

/**
 * Scoring queue processor. Two job kinds:
 *   - 'decay-sweep': fan out a per-tenant decay job for every active tenant
 *     (triggered by the nightly repeatable schedule).
 *   - 'decay': rescore a single tenant's open leads so quiet ones cool off.
 */
export async function processScoring(job: Job): Promise<{ ok: boolean }> {
  if (job.name === 'decay-sweep') return decaySweep();
  return decayTenant((job.data as { tenantId: string }).tenantId);
}

async function decaySweep(): Promise<{ ok: boolean }> {
  const rows = await prisma.$queryRaw<{ list_active_tenant_ids: string }[]>`
    SELECT list_active_tenant_ids()`;
  for (const r of rows) {
    await enqueue(QUEUES.SCORING, 'decay', { tenantId: r.list_active_tenant_ids });
  }
  logger.info({ tenants: rows.length }, 'enqueued nightly decay sweep');
  return { ok: true };
}

async function decayTenant(tenantId: string): Promise<{ ok: boolean }> {
  await withTenant(tenantId, async (tx) => {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
    const weights = {
      ...DEFAULT_WEIGHTS,
      ...((tenant?.scoringWeights ?? {}) as Partial<ScoringWeights>),
    };
    const leads = await tx.lead.findMany({ where: { stage: { notIn: ['Booked', 'Lost'] } } });
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
      }
    }
  });
  return { ok: true };
}
