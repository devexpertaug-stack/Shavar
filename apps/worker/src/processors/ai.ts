import type { Job } from 'bullmq';
import type IORedis from 'ioredis';
import {
  createLlmProvider,
  computeScore,
  tierForScore,
  type LlmProvider,
  type ScoringWeights,
} from '@estateflow/shared';
import { withTenant } from '../prisma';
import { publishRealtime } from '../realtime-publisher';
import { logger } from '../logger';

interface AiJob {
  tenantId: string;
  leadId: string;
}

let llm: LlmProvider | null = null;
function provider(): LlmProvider {
  if (!llm) llm = createLlmProvider();
  return llm;
}

/**
 * AI qualification step (PRD §4.3 / FR-8..9). After each inbound message:
 * build the recent conversation, extract strict qualification JSON, persist it
 * on the lead, and log token/cost usage. Scoring stays in deterministic code
 * (Task 7); this step only extracts fields.
 */
export async function processAi(job: Job, redis: IORedis): Promise<{ ok: boolean }> {
  const { tenantId, leadId } = job.data as AiJob;

  const conversation = await withTenant(tenantId, async (tx) => {
    const msgs = await tx.message.findMany({
      where: { leadId },
      orderBy: { createdAt: 'asc' },
      take: 40,
    });
    return msgs
      .map((m) => `${m.direction === 'INBOUND' ? 'Lead' : 'Agent'}: ${m.body ?? `[${m.type}]`}`)
      .join('\n');
  });
  if (!conversation.trim()) return { ok: true };

  const { qualification, usage } = await provider().extract({ conversation });

  const scored = await withTenant(tenantId, async (tx) => {
    const lead = await tx.lead.findUnique({ where: { id: leadId } });
    if (!lead) return null;

    const inboundCount = await tx.message.count({ where: { leadId, direction: 'INBOUND' } });
    const daysSinceLastInbound = lead.lastInboundAt
      ? Math.floor((Date.now() - new Date(lead.lastInboundAt).getTime()) / 86_400_000)
      : 0;

    // Tenant-configurable weights (PRD §4.3). Falls back to defaults.
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
    const weights = (tenant?.scoringWeights ?? {}) as Partial<ScoringWeights>;

    const result = computeScore(
      { qualification, inboundCount, source: lead.source, daysSinceLastInbound },
      Object.keys(weights).length ? (weights as ScoringWeights) : undefined,
    );

    const oldScore = lead.score;
    await tx.lead.update({
      where: { id: leadId },
      data: {
        qualification: qualification as unknown as object,
        score: result.score,
        tier: tierForScore(result.score),
      },
    });
    if (result.score !== oldScore) {
      await tx.scoreEvent.create({
        data: {
          tenantId,
          leadId,
          oldScore,
          newScore: result.score,
          reasons: result.reasons as unknown as object,
        },
      });
      await tx.activity.create({
        data: {
          tenantId,
          leadId,
          type: 'SCORE_CHANGE',
          payload: { from: oldScore, to: result.score, tier: result.tier },
        },
      });
    }

    await tx.llmUsage.create({
      data: {
        tenantId,
        leadId,
        model: usage.model,
        operation: 'extract',
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        costMicroUsd: usage.costMicroUsd,
      },
    });

    return result;
  });

  await publishRealtime(redis, {
    tenantId,
    leadId,
    event: 'lead:qualification',
    payload: { leadId, qualification, score: scored?.score, tier: scored?.tier },
  });
  logger.info(
    { tenantId, leadId, intent: qualification.intent, score: scored?.score },
    'qualified + scored lead',
  );
  return { ok: true };
}
