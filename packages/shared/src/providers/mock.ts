import { randomUUID } from 'node:crypto';
import {
  ParsedWebhookSchema,
  type ParsedWebhook,
  type SendInteractiveInput,
  type SendMediaInput,
  type SendResult,
  type SendTemplateInput,
  type WhatsAppProvider,
} from '../whatsapp';

/**
 * Mock WhatsApp provider for local development and tests. Its webhook format is
 * our own normalized shape, so it is trivial to post a fake inbound message.
 * verifyWebhook accepts when the configured secret matches the x-mock-secret
 * header (or when no secret is configured).
 */
export class MockWhatsAppProvider implements WhatsAppProvider {
  readonly type = 'MOCK' as const;

  verifyWebhook(input: {
    headers: Record<string, string | undefined>;
    secret?: string;
  }): boolean {
    if (!input.secret) return true;
    return input.headers['x-mock-secret'] === input.secret;
  }

  parseWebhook(body: unknown): ParsedWebhook {
    // Accept either our normalized shape directly, or a single-message shortcut.
    const b = (body ?? {}) as Record<string, unknown>;
    if (b.messages || b.statuses) {
      return ParsedWebhookSchema.parse(b);
    }
    if (b.from && b.text !== undefined) {
      return ParsedWebhookSchema.parse({
        messages: [
          {
            providerMessageId: (b.providerMessageId as string) ?? `mock_${randomUUID()}`,
            from: b.from,
            type: 'text',
            text: b.text,
            timestamp: (b.timestamp as string) ?? new Date().toISOString(),
            contactName: (b.contactName as string) ?? null,
            raw: b,
          },
        ],
      });
    }
    return ParsedWebhookSchema.parse({});
  }

  private ok(): Promise<SendResult> {
    return Promise.resolve({ providerMessageId: `mock_out_${randomUUID()}` });
  }
  sendText(_to: string, _text: string): Promise<SendResult> {
    return this.ok();
  }
  sendTemplate(_input: SendTemplateInput): Promise<SendResult> {
    return this.ok();
  }
  sendMedia(_input: SendMediaInput): Promise<SendResult> {
    return this.ok();
  }
  sendInteractive(_input: SendInteractiveInput): Promise<SendResult> {
    return this.ok();
  }
}
