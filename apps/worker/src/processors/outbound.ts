import type { Job } from 'bullmq';
import type IORedis from 'ioredis';
import {
  createWhatsAppProvider,
  decryptJson,
  loadEncryptionKey,
  type ProviderConfig,
  type SendResult,
} from '@estateflow/shared';
import { withTenant } from '../prisma';
import { publishRealtime } from '../realtime-publisher';
import { logger } from '../logger';

interface OutboundJob {
  tenantId: string;
  messageId: string;
  to: string;
  kind: 'text' | 'media' | 'template' | 'interactive';
  text?: string;
  mediaUrl?: string;
  templateName?: string;
  templateParams?: string[];
}

let encKey: Buffer | null = null;
function key(): Buffer {
  if (!encKey) encKey = loadEncryptionKey(process.env.ENCRYPTION_KEY);
  return encKey;
}

/**
 * Outbound send step (PRD §6). Resolves the tenant's active provider, sends via
 * the adapter, then updates the message to `sent` with the provider id (or
 * `failed`), publishing a realtime status update either way. Throwing re-queues
 * the job with backoff (BullMQ) and lands in the DLQ after retries.
 */
export async function processOutbound(job: Job, redis: IORedis): Promise<{ ok: boolean }> {
  const data = job.data as OutboundJob;
  const { tenantId, messageId } = data;

  const cred = await withTenant(tenantId, (tx) =>
    tx.providerCredential.findFirst({ where: { isActive: true } }),
  );
  if (!cred) {
    await markFailed(tenantId, messageId, redis, 'no active provider');
    return { ok: false };
  }

  const cfg = decryptJson<ProviderConfig>(key(), cred.encryptedConfig);
  const provider = createWhatsAppProvider(cfg);

  let result: SendResult;
  try {
    switch (data.kind) {
      case 'template':
        result = await provider.sendTemplate({
          to: data.to,
          templateName: data.templateName!,
          params: data.templateParams,
        });
        break;
      case 'media':
        result = await provider.sendMedia({ to: data.to, mediaUrl: data.mediaUrl!, type: 'image' });
        break;
      case 'interactive':
        result = await provider.sendInteractive({
          to: data.to,
          bodyText: data.text ?? '',
          buttonText: 'Choose',
          rows: [],
        });
        break;
      default:
        result = await provider.sendText(data.to, data.text ?? '');
    }
  } catch (err) {
    logger.error({ tenantId, messageId, err: (err as Error).message }, 'outbound send failed');
    await markFailed(tenantId, messageId, redis, (err as Error).message);
    throw err; // let BullMQ retry
  }

  const updated = await withTenant(tenantId, (tx) =>
    tx.message.update({
      where: { id: messageId },
      data: { status: 'sent', providerMessageId: result.providerMessageId || null },
    }),
  );
  await publishRealtime(redis, {
    tenantId,
    leadId: updated.leadId,
    event: 'message:status',
    payload: { id: messageId, status: 'sent' },
  });
  logger.info({ tenantId, messageId }, 'outbound sent');
  return { ok: true };
}

async function markFailed(
  tenantId: string,
  messageId: string,
  redis: IORedis,
  _reason: string,
): Promise<void> {
  const updated = await withTenant(tenantId, (tx) =>
    tx.message.update({ where: { id: messageId }, data: { status: 'failed' } }),
  ).catch(() => null);
  if (updated) {
    await publishRealtime(redis, {
      tenantId,
      leadId: updated.leadId,
      event: 'message:status',
      payload: { id: messageId, status: 'failed' },
    });
  }
}
