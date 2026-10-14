import { Worker, type Processor } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from './logger';
import { QUEUES, type QueueName } from './queues';

/**
 * Worker bootstrap (Task 1 skeleton). Registers one BullMQ Worker per queue
 * with a placeholder processor. Later tasks replace the placeholders with the
 * real inbound/ai/scoring/routing/outbound/media/campaign/sla handlers.
 */

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

const placeholder =
  (queue: QueueName): Processor =>
  async (job) => {
    logger.info({ queue, jobId: job.id, name: job.name }, 'processed (placeholder)');
    return { ok: true };
  };

const workers: Worker[] = [];

function start(): void {
  for (const queue of Object.values(QUEUES)) {
    const worker = new Worker(queue, placeholder(queue), { connection, concurrency: 5 });
    worker.on('failed', (job, err) => {
      logger.error({ queue, jobId: job?.id, err: err.message }, 'job failed');
    });
    workers.push(worker);
  }
  logger.info({ queues: Object.values(QUEUES) }, 'EstateFlow worker started');
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down worker');
  await Promise.allSettled(workers.map((w) => w.close()));
  await connection.quit();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

start();
