import type { Job } from 'bullmq';
import type IORedis from 'ioredis';
import { createLlmProvider, type LlmProvider } from '@estateflow/shared';
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

  await withTenant(tenantId, async (tx) => {
    await tx.lead.update({
      where: { id: leadId },
      data: { qualification: qualification as unknown as object },
    });
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
  });

  await publishRealtime(redis, {
    tenantId,
    leadId,
    event: 'lead:qualification',
    payload: { leadId, qualification },
  });
  logger.info({ tenantId, leadId, intent: qualification.intent }, 'qualified lead');
  return { ok: true };
}
