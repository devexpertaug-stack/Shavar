import { createHmac, timingSafeEqual } from 'node:crypto';
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

export interface AiSensyConfig {
  apiKey?: string;
  baseUrl?: string; // e.g. https://backend.aisensy.com
  webhookSecret?: string;
  phoneNumberId?: string;
}

const TYPE_MAP: Record<string, WaMessageType> = {
  text: 'text',
  image: 'image',
  audio: 'audio',
  video: 'video',
  document: 'document',
  interactive: 'interactive',
  button: 'interactive',
};

/**
 * AiSensy adapter. AiSensy resells the Meta Cloud API, so its inbound webhook
 * follows the Meta Cloud shape: entry[].changes[].value.{messages,statuses}.
 * Verification uses an HMAC-SHA256 signature over the raw body (x-hub-style),
 * falling back to a shared-secret header when configured that way.
 */
export class AiSensyProvider implements WhatsAppProvider {
  readonly type = 'AISENSY' as const;

  constructor(private readonly config: AiSensyConfig) {}

  verifyWebhook(input: {
    rawBody: string;
    headers: Record<string, string | undefined>;
    query: Record<string, string | undefined>;
    secret?: string;
  }): boolean {
    const secret = input.secret ?? this.config.webhookSecret;
    if (!secret) return true;

    // Preferred: HMAC-SHA256 signature (sha256=...), like Meta's x-hub-signature-256.
    const sig = input.headers['x-hub-signature-256'] ?? input.headers['x-aisensy-signature'];
    if (sig) {
      const expected = 'sha256=' + createHmac('sha256', secret).update(input.rawBody).digest('hex');
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      return a.length === b.length && timingSafeEqual(a, b);
    }

    // Fallback: shared secret token in a header or query param.
    const token = input.headers['x-aisensy-token'] ?? input.query['token'];
    return token === secret;
  }

  parseWebhook(body: unknown): ParsedWebhook {
    const payload = (body ?? {}) as Record<string, unknown>;
    const messages: InboundMessage[] = [];
    const statuses: StatusUpdate[] = [];

    const entries = Array.isArray(payload.entry) ? (payload.entry as Record<string, unknown>[]) : [];
    for (const entry of entries) {
      const changes = Array.isArray(entry.changes) ? (entry.changes as Record<string, unknown>[]) : [];
      for (const change of changes) {
        const value = (change.value ?? {}) as Record<string, unknown>;
        const contacts = Array.isArray(value.contacts)
          ? (value.contacts as Record<string, unknown>[])
          : [];
        const nameByWaId = new Map<string, string>();
        for (const c of contacts) {
          const profile = (c.profile ?? {}) as Record<string, unknown>;
          if (c.wa_id && profile.name) nameByWaId.set(String(c.wa_id), String(profile.name));
        }

        for (const m of (value.messages as Record<string, unknown>[]) ?? []) {
          messages.push(this.toInbound(m, nameByWaId));
        }
        for (const s of (value.statuses as Record<string, unknown>[]) ?? []) {
          const mapped = this.mapStatus(String(s.status ?? ''));
          if (mapped) {
            statuses.push({
              providerMessageId: String(s.id ?? ''),
              status: mapped,
              timestamp: this.ts(s.timestamp),
            });
          }
        }
      }
    }

    return ParsedWebhookSchema.parse({ messages, statuses });
  }

  private toInbound(m: Record<string, unknown>, names: Map<string, string>): InboundMessage {
    const rawType = String(m.type ?? 'text');
    const type = TYPE_MAP[rawType] ?? 'text';
    const from = String(m.from ?? '');
    const media = (m[rawType] ?? {}) as Record<string, unknown>;
    const textObj = (m.text ?? {}) as Record<string, unknown>;
    return {
      providerMessageId: String(m.id ?? ''),
      from,
      type,
      text: type === 'text' ? ((textObj.body as string) ?? null) : ((media.caption as string) ?? null),
      mediaUrl: (media.link as string) ?? (media.id as string) ?? null,
      mediaMimeType: (media.mime_type as string) ?? null,
      referral: (m.referral as Record<string, unknown>) ?? null,
      timestamp: this.ts(m.timestamp),
      contactName: names.get(from) ?? null,
      raw: m,
    };
  }

  private mapStatus(s: string): StatusUpdate['status'] | null {
    const v = s.toLowerCase();
    if (v === 'read') return 'read';
    if (v === 'delivered') return 'delivered';
    if (v === 'sent') return 'sent';
    if (v === 'failed') return 'failed';
    return null;
  }

  private ts(value: unknown): string {
    if (typeof value === 'number') return new Date(value * 1000).toISOString();
    if (typeof value === 'string' && value) {
      const n = Number(value);
      if (!Number.isNaN(n)) return new Date(n * 1000).toISOString();
      return new Date(value).toISOString();
    }
    return new Date().toISOString();
  }

  // --- Outbound --------------------------------------------------------------

  private async post(payload: Record<string, unknown>): Promise<SendResult> {
    const base = this.config.baseUrl ?? 'https://backend.aisensy.com';
    const res = await fetch(`${base}/campaign/t1/api/v2`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: this.config.apiKey, ...payload }),
    });
    if (!res.ok) throw new Error(`AiSensy send failed: ${res.status}`);
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { providerMessageId: String(json.messageId ?? json.id ?? '') };
  }

  sendText(to: string, text: string): Promise<SendResult> {
    return this.post({ to, type: 'text', text });
  }
  sendTemplate(input: SendTemplateInput): Promise<SendResult> {
    return this.post({
      to: input.to,
      campaignName: input.templateName,
      templateParams: input.params ?? [],
    });
  }
  sendMedia(input: SendMediaInput): Promise<SendResult> {
    return this.post({ to: input.to, type: input.type, mediaUrl: input.mediaUrl, caption: input.caption });
  }
  sendInteractive(input: SendInteractiveInput): Promise<SendResult> {
    return this.post({
      to: input.to,
      type: 'interactive',
      body: input.bodyText,
      buttonText: input.buttonText,
      rows: input.rows,
    });
  }
}
