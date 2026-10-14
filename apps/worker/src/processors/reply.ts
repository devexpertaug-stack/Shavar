import type { Job } from 'bullmq';
import type IORedis from 'ioredis';
import {
  createLlmProvider,
  decideAgentAction,
  buildAgentSystemPrompt,
  passesHardFilters,
  type AgentGuardrails,
  type LlmProvider,
  type Qualification,
} from '@estateflow/shared';
import { withTenant } from '../prisma';
import { enqueue, QUEUES } from '../producer';
import { publishRealtime } from '../realtime-publisher';
import { logger } from '../logger';

interface ReplyJob {
  tenantId: string;
  leadId: string;
}

let llm: LlmProvider | null = null;
function provider(): LlmProvider {
  if (!llm) llm = createLlmProvider();
  return llm;
}

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * AI auto-reply agent (PRD §4.2 / Task 10). Decides whether to reply or hand
 * over; when replying it grounds the LLM on matched inventory (never invents
 * prices) and mirrors the lead's language, then queues an outbound AI message.
 */
export async function processReply(job: Job, redis: IORedis): Promise<{ ok: boolean }> {
  const { tenantId, leadId } = job.data as ReplyJob;

  const prepared = await withTenant(tenantId, async (tx) => {
    const lead = await tx.lead.findUnique({ where: { id: leadId }, include: { contact: true } });
    if (!lead) return null;

    const lastInbound = await tx.message.findFirst({
      where: { leadId, direction: 'INBOUND' },
      orderBy: { createdAt: 'desc' },
    });
    const aiMessagesToday = await tx.message.count({
      where: { leadId, direction: 'OUTBOUND', sentBy: 'ai', createdAt: { gte: startOfToday() } },
    });
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
    const guardrails = (tenant?.aiConfig ?? {}) as AgentGuardrails;
    const qualification = lead.qualification as unknown as Qualification;

    return { lead, lastInbound, aiMessagesToday, guardrails, qualification };
  });
  if (!prepared) return { ok: true };

  const { lead, lastInbound, aiMessagesToday, guardrails, qualification } = prepared;

  const decision = decideAgentAction({
    aiActive: lead.aiActive,
    lastInboundText: lastInbound?.body ?? null,
    qualification,
    aiMessagesToday,
    lastInboundAt: lead.lastInboundAt,
    guardrails,
  });

  if (decision.handover) {
    await withTenant(tenantId, async (tx) => {
      await tx.lead.update({ where: { id: leadId }, data: { aiActive: false } });
      await tx.activity.create({
        data: { tenantId, leadId, type: 'NOTE', payload: { handover: true, reason: decision.reason } },
      });
      if (lead.assignedTo) {
        await tx.notification.create({
          data: {
            tenantId,
            userId: lead.assignedTo,
            type: 'SYSTEM',
            title: 'AI handed over a conversation',
            body: `Reason: ${decision.reason}`,
            leadId,
          },
        });
      }
    });
    if (lead.assignedTo) {
      await publishRealtime(redis, {
        tenantId,
        userId: lead.assignedTo,
        event: 'notification:new',
        payload: { leadId, type: 'handover', reason: decision.reason },
      });
    }
    logger.info({ tenantId, leadId, reason: decision.reason }, 'AI handover');
    return { ok: true };
  }

  if (!decision.shouldReply) {
    logger.info({ tenantId, leadId, reason: decision.reason }, 'AI silent');
    return { ok: true };
  }

  // RAG: ground the reply on matching inventory (prices come only from here).
  const inventoryContext = await withTenant(tenantId, async (tx) => {
    const units = await tx.unit.findMany({
      where: { isAvailable: true },
      include: { project: true },
      take: 100,
    });
    const matches = units
      .filter((u) =>
        passesHardFilters(
          { bhk: u.bhk, priceMin: u.priceMin, priceMax: u.priceMax, location: u.project.location, isAvailable: u.isAvailable },
          qualification,
        ),
      )
      .slice(0, 3)
      .map((u) => `${u.project.name} ${u.name}: ${u.bhk}BHK, ${u.project.location}, ₹${u.priceMin}-${u.priceMax}`);
    return matches.join('\n');
  });

  const system = buildAgentSystemPrompt({
    guardrails,
    qualification,
    inventoryContext,
    detectedLanguage: lead.contact.language,
  });
  const { text, usage } = await provider().chat([
    { role: 'system', content: system },
    { role: 'user', content: lastInbound?.body ?? 'Hello' },
  ]);

  // Persist a queued AI message + log usage, then send via the outbound queue.
  const messageId = await withTenant(tenantId, async (tx) => {
    const msg = await tx.message.create({
      data: {
        tenantId,
        leadId,
        direction: 'OUTBOUND',
        type: 'text',
        body: text,
        status: 'queued',
        sentBy: 'ai',
      },
    });
    await tx.llmUsage.create({
      data: {
        tenantId,
        leadId,
        model: usage.model,
        operation: 'chat',
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        costMicroUsd: usage.costMicroUsd,
      },
    });
    return msg.id;
  });

  await enqueue(QUEUES.OUTBOUND, 'send', {
    tenantId,
    messageId,
    to: lead.contact.phoneE164,
    kind: 'text',
    text,
  });
  logger.info({ tenantId, leadId }, 'AI replied');
  return { ok: true };
}
