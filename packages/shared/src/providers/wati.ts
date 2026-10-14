import { timingSafeEqual } from 'node:crypto';
import {
  ParsedWebhookSchema,
  type InboundMessage,
  type ParsedWebhook,
  type SendInteractiveInput,
  type SendMediaInput,
  type SendResult,
  type SendTemplateInput,
  type StatusUpdate,
  type WaMessageType,
  type WhatsAppProvider,
} from '../whatsapp';

export interface WatiConfig {
  apiKey?: string;
  baseUrl?: string; // e.g. https://live-mt-server.wati.io/<tenantId>
  webhookSecret?: string;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

const WATI_TYPE_MAP: Record<string, WaMessageType> = {
  text: 'text',
  image: 'image',
  audio: 'audio',
  voice: 'audio',
  video: 'video',
  document: 'document',
  interactive: 'interactive',
  button: 'interactive',
};

/**
 * WATI adapter. WATI delivers a shared secret with each webhook (header or
 * query param, tenant-configured); we compare it in constant time. Inbound
 * messages carry `waId` (sender), `text`, `type`, and `id`
 * (provider message id). Status events carry `statusString`/`eventType`.
 */
export class WatiProvider implements WhatsAppProvider {
  readonly type = 'WATI' as const;

  constructor(private readonly config: WatiConfig) {}

  verifyWebhook(input: {
    headers: Record<string, string | undefined>;
    query: Record<string, string | undefined>;
    secret?: string;
  }): boolean {
    const expected = input.secret ?? this.config.webhookSecret;
    if (!expected) return true; // no secret configured => accept (dev)
    const provided =
      input.headers['x-wati-signature'] ??
      input.headers['authorization'] ??
      input.query['token'] ??
      input.query['secret'];
    return typeof provided === 'string' && safeEqual(provided, expected);
  }

  parseWebhook(body: unknown): ParsedWebhook {
    const payload = (body ?? {}) as Record<string, unknown>;
    const messages: InboundMessage[] = [];
    const statuses: StatusUpdate[] = [];

    const eventType = String(payload.eventType ?? '');

    // Status/ack events (sent/delivered/read).
    const statusString = payload.statusString ?? payload.status;
    if (eventType.toLowerCase().includes('status') || (statusString && !payload.text)) {
      const mapped = this.mapStatus(String(statusString ?? ''));
      if (mapped) {
        statuses.push({
          providerMessageId: String(payload.id ?? payload.localMessageId ?? payload.whatsappMessageId ?? ''),
          status: mapped,
          timestamp: this.ts(payload.timestamp),
        });
      }
      return ParsedWebhookSchema.parse({ messages, statuses });
    }

    // Inbound message.
    const waId = payload.waId ?? payload.senderPhone ?? payload.from;
    if (waId) {
      const rawType = String(payload.type ?? 'text');
      messages.push({
        providerMessageId: String(payload.id ?? payload.whatsappMessageId ?? ''),
        from: String(waId),
        type: WATI_TYPE_MAP[rawType] ?? 'text',
        text: (payload.text as string) ?? null,
        mediaUrl: (payload.data as string) ?? (payload.mediaUrl as string) ?? null,
        mediaMimeType: (payload.mimeType as string) ?? null,
        referral: (payload.referral as Record<string, unknown>) ?? null,
        timestamp: this.ts(payload.timestamp),
        contactName: (payload.senderName as string) ?? null,
        raw: payload,
      });
    }

    return ParsedWebhookSchema.parse({ messages, statuses });
  }

  private mapStatus(s: string): StatusUpdate['status'] | null {
    const v = s.toLowerCase();
    if (v.includes('read')) return 'read';
    if (v.includes('deliver')) return 'delivered';
    if (v.includes('sent')) return 'sent';
    if (v.includes('fail') || v.includes('error')) return 'failed';
    return null;
  }

  private ts(value: unknown): string {
    if (typeof value === 'number') return new Date(value * 1000).toISOString();
    if (typeof value === 'string' && value) {
      const n = Number(value);
      if (!Number.isNaN(n) && value.length <= 11) return new Date(n * 1000).toISOString();
      return new Date(value).toISOString();
    }
    return new Date().toISOString();
  }

  // --- Outbound (HTTP calls to the WATI API) ---------------------------------

  private async post(path: string, payload: unknown): Promise<SendResult> {
    const base = this.config.baseUrl ?? '';
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.config.apiKey ? `Bearer ${this.config.apiKey}` : '',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`WATI send failed: ${res.status}`);
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { providerMessageId: String(json.id ?? json.messageId ?? '') };
  }

  sendText(to: string, text: string): Promise<SendResult> {
    return this.post(`/api/v1/sendSessionMessage/${to}`, { messageText: text });
  }
  sendTemplate(input: SendTemplateInput): Promise<SendResult> {
    return this.post('/api/v1/sendTemplateMessage', {
      whatsappNumber: input.to,
      template_name: input.templateName,
      broadcast_name: input.templateName,
      parameters: (input.params ?? []).map((v, i) => ({ name: String(i + 1), value: v })),
    });
  }
  sendMedia(input: SendMediaInput): Promise<SendResult> {
    return this.post(`/api/v1/sendSessionFile/${input.to}`, {
      mediaUrl: input.mediaUrl,
      caption: input.caption,
    });
  }
  sendInteractive(input: SendInteractiveInput): Promise<SendResult> {
    return this.post(`/api/v1/sendInteractiveListMessage/${input.to}`, {
      body: input.bodyText,
      buttonText: input.buttonText,
      sections: [{ rows: input.rows }],
    });
  }
}
