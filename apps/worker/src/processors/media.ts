import type { Job } from 'bullmq';
import type IORedis from 'ioredis';
import { createSttProvider, type SttProvider } from '@estateflow/shared';
import { withTenant } from '../prisma';
import { enqueue, QUEUES } from '../producer';
import { publishRealtime } from '../realtime-publisher';
import { logger } from '../logger';

interface MediaJob {
  tenantId: string;
  leadId: string;
  messageId: string;
  mediaUrl: string | null;
  mimeType?: string | null;
}

let stt: SttProvider | null = null;
function provider(): SttProvider {
  if (!stt) stt = createSttProvider();
  return stt;
}

/**
 * Media/transcription step (PRD §4.2 / FR-6, Task 11). Downloads the audio,
 * transcribes it, stores the transcript on the message, then feeds it into the
 * same AI qualification pipeline as text. On any failure the message keeps a
 * safe fallback transcript so the thread still progresses.
 */
export async function processMedia(job: Job, redis: IORedis): Promise<{ ok: boolean }> {
  const { tenantId, leadId, messageId, mediaUrl, mimeType } = job.data as MediaJob;

  let transcript = '[voice note]';
  try {
    if (mediaUrl) {
      const res = await fetch(mediaUrl);
      if (res.ok) {
        const audio = Buffer.from(await res.arrayBuffer());
        const result = await provider().transcribe({
          audio,
          mimeType: mimeType ?? 'audio/ogg',
        });
        transcript = result.transcript;
      }
    }
  } catch (err) {
    logger.warn({ tenantId, messageId, err: (err as Error).message }, 'transcription failed; using fallback');
    transcript = '[voice note — transcription unavailable]';
  }

  await withTenant(tenantId, async (tx) => {
    await tx.message.update({ where: { id: messageId }, data: { transcript, body: transcript } });
  });

  await publishRealtime(redis, {
    tenantId,
    leadId,
    event: 'message:transcribed',
    payload: { messageId, transcript },
  });

  // Feed the transcript into the same qualify->reply pipeline as text.
  try {
    await enqueue(QUEUES.AI, 'qualify', { tenantId, leadId });
  } catch (err) {
    logger.warn({ tenantId, err: (err as Error).message }, 'failed to enqueue AI after transcription');
  }

  logger.info({ tenantId, leadId, messageId }, 'transcribed voice note');
  return { ok: true };
}
