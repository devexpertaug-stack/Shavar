import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

/** Pipeline queue names (kept in sync with apps/worker/src/queues.ts). */
export const QUEUES = {
  INBOUND: 'inbound.message',
  AI: 'ai.process',
  SCORING: 'scoring.compute',
  ROUTING: 'routing.assign',
  OUTBOUND: 'outbound.message',
  MEDIA: 'media.process',
  CAMPAIGNS: 'campaigns.dispatch',
  SLA: 'sla.escalation',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 1000 },
  removeOnComplete: 1000,
  removeOnFail: false,
};

/**
 * Lazily-created BullMQ producers. BullMQ requires a connection with
 * maxRetriesPerRequest=null, so we use a dedicated connection rather than the
 * shared REDIS_CLIENT (which is tuned for fail-fast health probes).
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    // Don't connect at construction; the app (and /health) must boot without
    // Redis. Connects on first enqueue. Swallow connection errors as warnings.
    lazyConnect: true,
  });
  private readonly queues = new Map<QueueName, Queue>();

  constructor() {
    this.connection.on('error', (e) => this.logger.warn(`redis error: ${e.message}`));
  }

  private queue(name: QueueName): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, {
        connection: this.connection,
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      });
      this.queues.set(name, q);
    }
    return q;
  }

  async enqueue(name: QueueName, jobName: string, data: unknown, opts?: { jobId?: string }) {
    const job = await this.queue(name).add(jobName, data, opts);
    this.logger.debug(`enqueued ${name}/${jobName} (${job.id})`);
    return job;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([...this.queues.values()].map((q) => q.close()));
    await this.connection.quit().catch(() => this.connection.disconnect());
  }
}
