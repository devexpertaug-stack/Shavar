import type IORedis from 'ioredis';

/**
 * The worker can't call the API's Socket.io gateway directly (separate
 * process), so it publishes realtime events to a Redis channel. The API's
 * gateway subscribes and re-emits to the right rooms. Keep this payload shape
 * in sync with the API's realtime subscriber.
 */
export const REALTIME_CHANNEL = 'estateflow:realtime';

export interface RealtimeEvent {
  tenantId: string;
  leadId?: string;
  userId?: string;
  event: string;
  payload: unknown;
}

export function publishRealtime(redis: IORedis, evt: RealtimeEvent): Promise<number> {
  return redis.publish(REALTIME_CHANNEL, JSON.stringify(evt));
}
