import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import IORedis from 'ioredis';
import { TokenService } from '../auth/token.service';

/** Must match apps/worker/src/realtime-publisher.ts. */
const REALTIME_CHANNEL = 'estateflow:realtime';
interface BridgedEvent {
  tenantId: string;
  leadId?: string;
  userId?: string;
  event: string;
  payload: unknown;
}

/**
 * Socket.io gateway (PRD §8 realtime). Namespace /rt with rooms per tenant,
 * user and lead. Clients authenticate with the access token (handshake auth or
 * ?token=) and are auto-joined to their tenant + user rooms; they may join
 * specific lead rooms. Server code emits via emitToTenant / emitToLead.
 */
@WebSocketGateway({ namespace: '/rt', cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayConnection, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeGateway.name);
  @WebSocketServer() server!: Server;
  private sub?: IORedis;

  constructor(private readonly tokens: TokenService) {}

  /** Subscribe to the worker->API realtime bridge channel and re-emit. */
  onModuleInit(): void {
    this.sub = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
      lazyConnect: true,
      // Give up after a few attempts so a missing Redis can't flood logs or
      // keep the process from settling (the app must boot without Redis).
      retryStrategy: (times) => (times > 5 ? null : Math.min(times * 200, 2000)),
    });
    this.sub.on('error', (e) => this.logger.warn(`realtime sub error: ${e.message}`));
    this.sub.connect().catch((e) => this.logger.warn(`realtime sub connect failed: ${e.message}`));
    this.sub.on('message', (_channel, raw) => {
      try {
        const evt = JSON.parse(raw) as BridgedEvent;
        if (evt.leadId) this.emitToLead(evt.tenantId, evt.leadId, evt.event, evt.payload);
        else if (evt.userId) this.emitToUser(evt.userId, evt.event, evt.payload);
        else this.emitToTenant(evt.tenantId, evt.event, evt.payload);
        // Always also notify the tenant inbox room for list-level updates.
        if (evt.leadId) this.emitToTenant(evt.tenantId, evt.event, evt.payload);
      } catch {
        /* ignore malformed */
      }
    });
    this.sub.subscribe(REALTIME_CHANNEL).catch(() => undefined);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.sub) await this.sub.quit().catch(() => this.sub?.disconnect());
  }

  handleConnection(client: Socket): void {
    try {
      const token =
        (client.handshake.auth?.token as string | undefined) ??
        (client.handshake.query?.token as string | undefined);
      if (!token) {
        client.disconnect(true);
        return;
      }
      const payload = this.tokens.verifyAccess(token);
      client.join(`tenant:${payload.tid}`);
      client.join(`user:${payload.sub}`);
      client.data.tenantId = payload.tid;

      client.on('lead:subscribe', (leadId: string) => {
        if (typeof leadId === 'string') client.join(`lead:${payload.tid}:${leadId}`);
      });
      client.on('lead:unsubscribe', (leadId: string) => {
        if (typeof leadId === 'string') client.leave(`lead:${payload.tid}:${leadId}`);
      });
    } catch {
      client.disconnect(true);
    }
  }

  emitToTenant(tenantId: string, event: string, payload: unknown): void {
    this.server?.to(`tenant:${tenantId}`).emit(event, payload);
  }

  emitToUser(userId: string, event: string, payload: unknown): void {
    this.server?.to(`user:${userId}`).emit(event, payload);
  }

  emitToLead(tenantId: string, leadId: string, event: string, payload: unknown): void {
    this.server?.to(`lead:${tenantId}:${leadId}`).emit(event, payload);
  }
}
