import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { QUEUES, DEFAULT_JOB_OPTIONS, type QueueName } from './queues';

/**
 * Worker-side producer so one pipeline step can enqueue the next (e.g. inbound
 * -> ai -> scoring -> routing). Uses a dedicated connection (BullMQ requires
 * maxRetriesPerRequest=null).
 */
const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});
const queues = new Map<QueueName, Queue>();

function q(name: QueueName): Queue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
    queues.set(name, queue);
  }
  return queue;
}

export function enqueue(name: QueueName, jobName: string, data: unknown, opts?: { jobId?: string }) {
  return q(name).add(jobName, data, opts);
}

export { QUEUES };

export async function closeProducer(): Promise<void> {
  await Promise.allSettled([...queues.values()].map((x) => x.close()));
  await connection.quit().catch(() => connection.disconnect());
}
