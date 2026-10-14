import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { createWhatsAppProvider, type ProviderConfig } from '@estateflow/shared';
import { Public } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { QueueService, QUEUES } from '../queue/queue.service';

/**
 * Public WhatsApp webhook (PRD §8). Latency budget: ACK within 200ms and push
 * work onto the queue (PRD §5). Flow:
 *   1. resolve tenant from the opaque :tenantKey (RLS-safe bootstrap read)
 *   2. verify the provider signature/secret — reject bad ones
 *   3. parse to normalized messages/statuses
 *   4. enqueue each with a dedup jobId (providerMessageId) so a redelivery is
 *      idempotent, then 200 OK
 *
 * The GET handler supports Meta/Cloud-style hub.challenge verification.
 */
@ApiExcludeController()
@Controller('webhooks/whatsapp')
export class WebhookController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly queue: QueueService,
  ) {}

  @Public()
  @Get(':provider/:tenantKey')
  async verify(
    @Param('tenantKey') tenantKey: string,
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') verifyToken: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ): Promise<void> {
    const cred = await this.prisma.findCredentialByKey(tenantKey);
    if (!cred) {
      res.status(404).send('not found');
      return;
    }
    const cfg = this.crypto.decrypt<ProviderConfig>(cred.encryptedConfig);
    if (mode === 'subscribe' && verifyToken && verifyToken === cfg.webhookSecret) {
      res.status(200).send(challenge);
      return;
    }
    res.status(403).send('forbidden');
  }

  @Public()
  @Post(':provider/:tenantKey')
  async receive(
    @Param('tenantKey') tenantKey: string,
    @Headers() headers: Record<string, string | undefined>,
    @Query() query: Record<string, string | undefined>,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const cred = await this.prisma.findCredentialByKey(tenantKey);
    if (!cred) {
      // Don't leak which keys exist; still ACK-ish with 404.
      res.status(404).json({ ok: false });
      return;
    }

    const cfg = this.crypto.decrypt<ProviderConfig>(cred.encryptedConfig);
    const provider = createWhatsAppProvider(cfg);

    const rawBody =
      (req as Request & { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {});
    const authentic = provider.verifyWebhook({
      rawBody,
      headers,
      query,
      secret: cfg.webhookSecret,
    });
    if (!authentic) {
      res.status(401).json({ ok: false, error: 'invalid signature' });
      return;
    }

    let parsed;
    try {
      parsed = provider.parseWebhook(req.body);
    } catch {
      throw new BadRequestException('Unparseable webhook payload');
    }

    // Enqueue each message/status; dedup via jobId so redelivery is idempotent.
    await Promise.all([
      ...parsed.messages.map((m) =>
        this.queue.enqueue(
          QUEUES.INBOUND,
          'message',
          { tenantId: cred.tenantId, providerType: cred.type, message: m },
          { jobId: `in:${cred.tenantId}:${m.providerMessageId}` },
        ),
      ),
      ...parsed.statuses.map((s) =>
        this.queue.enqueue(
          QUEUES.INBOUND,
          'status',
          { tenantId: cred.tenantId, status: s },
          { jobId: `st:${cred.tenantId}:${s.providerMessageId}:${s.status}` },
        ),
      ),
    ]);

    res.status(200).json({ ok: true, accepted: parsed.messages.length + parsed.statuses.length });
  }
}
