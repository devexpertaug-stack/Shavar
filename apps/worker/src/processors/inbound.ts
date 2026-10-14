import type { Job } from 'bullmq';
import type IORedis from 'ioredis';
import {
  normalizePhoneE164,
  type InboundMessage,
  type StatusUpdate,
} from '@estateflow/shared';
import { withTenant } from '../prisma';
import { publishRealtime } from '../realtime-publisher';
import { logger } from '../logger';

interface MessageJob {
  tenantId: string;
  providerType: string;
  message: InboundMessage;
}
interface StatusJob {
  tenantId: string;
  status: StatusUpdate;
}

const WA_TO_DB_TYPE: Record<string, 'text' | 'image' | 'audio' | 'video' | 'document' | 'interactive'> =
  {
    text: 'text',
    image: 'image',
    audio: 'audio',
    video: 'video',
    document: 'document',
    interactive: 'interactive',
  };

/**
 * Inbound pipeline step (PRD §6). Idempotent on (tenantId, providerMessageId):
 * a redelivered webhook (same provider message id) is a no-op. Upserts the
 * contact (dedup by E.164), ensures a lead exists, stores the message, then
 * publishes a realtime event so the API can push it live.
 */
export async function processInbound(job: Job, redis: IORedis): Promise<{ ok: boolean }> {
  if (job.name === 'status') return processStatus(job.data as StatusJob);
  return processMessage(job.data as MessageJob, redis);
}

async function processMessage(data: MessageJob, redis: IORedis): Promise<{ ok: boolean }> {
  const { tenantId, message } = data;
  const phoneE164 = normalizePhoneE164(message.from) ?? message.from;

  const result = await withTenant(tenantId, async (tx) => {
    // Idempotency guard: if this provider message id already exists, skip.
    if (message.providerMessageId) {
      const existing = await tx.message.findUnique({
        where: {
          tenantId_providerMessageId: {
            tenantId,
            providerMessageId: message.providerMessageId,
          },
        },
      });
      if (existing) return { skipped: true as const, leadId: existing.leadId };
    }

    const contact = await tx.contact.upsert({
      where: { tenantId_phoneE164: { tenantId, phoneE164 } },
      update: message.contactName ? { name: message.contactName } : {},
      create: {
        tenantId,
        phoneE164,
        name: message.contactName ?? null,
      },
    });

    let lead = await tx.lead.findFirst({
      where: { contactId: contact.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!lead) {
      lead = await tx.lead.create({
        data: {
          tenantId,
          contactId: contact.id,
          source: 'WHATSAPP',
          stage: 'New',
          lastInboundAt: new Date(message.timestamp),
        },
      });
      await tx.activity.create({
        data: { tenantId, leadId: lead.id, type: 'ENQUIRY', payload: { note: 'Inbound WhatsApp' } },
      });
    } else {
      await tx.lead.update({
        where: { id: lead.id },
        data: { lastInboundAt: new Date(message.timestamp) },
      });
    }

    const stored = await tx.message.create({
      data: {
        tenantId,
        leadId: lead.id,
        direction: 'INBOUND',
        type: WA_TO_DB_TYPE[message.type] ?? 'text',
        body: message.text,
        mediaUrl: message.mediaUrl,
        providerMessageId: message.providerMessageId || null,
        status: 'received',
        sentBy: 'system',
      },
    });
    await tx.activity.create({
      data: {
        tenantId,
        leadId: lead.id,
        type: 'MESSAGE',
        payload: { direction: 'INBOUND', messageId: stored.id, preview: message.text?.slice(0, 80) },
      },
    });

    return { skipped: false as const, leadId: lead.id, message: stored };
  });

  if (result.skipped) {
    logger.info({ tenantId, providerMessageId: message.providerMessageId }, 'duplicate inbound, skipped');
    return { ok: true };
  }

  // Push the new message live to the lead's room + the tenant inbox.
  await publishRealtime(redis, {
    tenantId,
    leadId: result.leadId,
    event: 'message:new',
    payload: result.message,
  });
  logger.info({ tenantId, leadId: result.leadId }, 'stored inbound message');
  return { ok: true };
}

async function processStatus(data: StatusJob): Promise<{ ok: boolean }> {
  const { tenantId, status } = data;
  if (!status.providerMessageId) return { ok: true };
  await withTenant(tenantId, (tx) =>
    tx.message.updateMany({
      where: { providerMessageId: status.providerMessageId },
      data: { status: status.status },
    }),
  );
  return { ok: true };
}
