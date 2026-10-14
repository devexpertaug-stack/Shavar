import { Worker, type Processor } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from './logger';
import { QUEUES, type QueueName } from './queues';
import { processInbound } from './processors/inbound';
import { processOutbound } from './processors/outbound';
import { processAi } from './processors/ai';
import { processScoring } from './processors/scoring';
import { closeProducer, enqueue } from './producer';
import { prisma } from './prisma';

/**
 * Worker bootstrap. The inbound.message queue has a real processor (Task 4);
 * the remaining queues keep placeholders until their tasks land.
 */

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});
// Separate connection for publishing realtime events (pub/sub bridge to the API).
const pub = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

const placeholder =
  (queue: QueueName): Processor =>
  async (job) => {
    logger.info({ queue, jobId: job.id, name: job.name }, 'processed (placeholder)');
    return { ok: true };
  };

const PROCESSORS: Partial<Record<QueueName, Processor>> = {
  [QUEUES.INBOUND]: (job) => processInbound(job, pub),
  [QUEUES.OUTBOUND]: (job) => processOutbound(job, pub),
  [QUEUES.AI]: (job) => processAi(job, pub),
  [QUEUES.SCORING]: (job) => processScoring(job),
};

const workers: Worker[] = [];

function start(): void {
  for (const queue of Object.values(QUEUES)) {
    const processor = PROCESSORS[queue] ?? placeholder(queue);
    const worker = new Worker(queue, processor, { connection, concurrency: 5 });
    worker.on('failed', (job, err) => {
      logger.error({ queue, jobId: job?.id, err: err.message }, 'job failed');
    });
    workers.push(worker);
  }
  logger.info({ queues: Object.values(QUEUES) }, 'EstateFlow worker started');

  // Nightly cold-lead decay sweep (02:30). Repeatable jobs are deduped by key,
  // so re-registering on each boot is safe.
  enqueue(QUEUES.SCORING, 'decay-sweep', {}, undefined, {
    repeat: { pattern: '30 2 * * *' },
    jobId: 'nightly-decay-sweep',
  }).catch((err) => logger.warn({ err: (err as Error).message }, 'failed to schedule decay sweep'));
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down worker');
  await Promise.allSettled(workers.map((w) => w.close()));
  await closeProducer();
  await prisma.$disconnect();
  await Promise.allSettled([connection.quit(), pub.quit()]);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

start();
