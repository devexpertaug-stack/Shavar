import { z } from 'zod';
import { WhatsAppProviderType } from './enums';

/**
 * Provider-agnostic WhatsApp types (PRD §6 adapter layer). Each BSP adapter
 * (WATI, AiSensy, Meta Cloud, Mock) parses its own webhook payload into these
 * normalized shapes so the rest of the system never sees provider specifics.
 */

export const WaMessageType = z.enum(['text', 'image', 'audio', 'video', 'document', 'interactive']);
export type WaMessageType = z.infer<typeof WaMessageType>;

/** A single inbound message, normalized across providers. */
export const InboundMessageSchema = z.object({
  providerMessageId: z.string(),
  from: z.string(), // sender phone, normalized to E.164 by the worker
  to: z.string().optional(), // the business number
  type: WaMessageType,
  text: z.string().nullable().default(null),
  mediaUrl: z.string().nullable().default(null),
  mediaMimeType: z.string().nullable().default(null),
  // Click-to-WhatsApp ad attribution when present (FR-1).
  referral: z.record(z.unknown()).nullable().default(null),
  timestamp: z.string(), // ISO-8601
  contactName: z.string().nullable().default(null),
  raw: z.unknown().optional(),
});
export type InboundMessage = z.infer<typeof InboundMessageSchema>;

/** A delivery/read status update for a previously-sent message. */
export const StatusUpdateSchema = z.object({
  providerMessageId: z.string(),
  status: z.enum(['sent', 'delivered', 'read', 'failed']),
  timestamp: z.string(),
});
export type StatusUpdate = z.infer<typeof StatusUpdateSchema>;

/** Result of parsing a webhook body: zero or more messages and/or statuses. */
export const ParsedWebhookSchema = z.object({
  messages: z.array(InboundMessageSchema).default([]),
  statuses: z.array(StatusUpdateSchema).default([]),
});
export type ParsedWebhook = z.infer<typeof ParsedWebhookSchema>;

/** Result of an outbound send. */
export interface SendResult {
  providerMessageId: string;
}

export interface SendMediaInput {
  to: string;
  mediaUrl: string;
  caption?: string;
  type: 'image' | 'audio' | 'video' | 'document';
  filename?: string;
}

export interface InteractiveListRow {
  id: string;
  title: string;
  description?: string;
}
export interface SendInteractiveInput {
  to: string;
  bodyText: string;
  buttonText: string;
  rows: InteractiveListRow[];
}

export interface SendTemplateInput {
  to: string;
  templateName: string;
  languageCode?: string;
  // Positional body params substituted into the approved template.
  params?: string[];
}

/**
 * The adapter contract every BSP implementation satisfies. verifyWebhook
 * decides whether a webhook request is authentic (signature/secret). All send*
 * methods talk to the provider's API.
 */
export interface WhatsAppProvider {
  readonly type: WhatsAppProviderType;
  verifyWebhook(input: {
    rawBody: string;
    headers: Record<string, string | undefined>;
    query: Record<string, string | undefined>;
    secret?: string;
  }): boolean;
  parseWebhook(body: unknown): ParsedWebhook;
  sendText(to: string, text: string): Promise<SendResult>;
  sendTemplate(input: SendTemplateInput): Promise<SendResult>;
  sendMedia(input: SendMediaInput): Promise<SendResult>;
  sendInteractive(input: SendInteractiveInput): Promise<SendResult>;
}

/** Decrypted provider config (shape varies slightly per BSP). */
export const ProviderConfigSchema = z.object({
  type: WhatsAppProviderType,
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  webhookSecret: z.string().optional(),
  phoneNumberId: z.string().optional(),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
