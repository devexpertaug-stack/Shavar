/**
 * Queue names for the EstateFlow pipeline (PRD §6 architecture).
 * Each will get a dedicated BullMQ Worker in the tasks that introduce them.
 */
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

/** Default job options: retry with exponential backoff; failures land in DLQ. */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 1000 },
  removeOnComplete: 1000,
  removeOnFail: false,
};
