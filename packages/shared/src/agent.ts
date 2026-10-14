import type { Qualification } from './qualification';
import { isWithinSessionWindow } from './window';

/**
 * AI reply agent helpers (PRD §4.2 / Task 10). Decision logic is pure and
 * tested; the worker wires it to the LLM + DB.
 */

export interface AgentGuardrails {
  persona?: string;
  tone?: string;
  topicsToAvoid?: string[];
  workingHours?: { start: number; end: number; tz?: string } | null; // 24h local hours
  maxAiMessagesPerLeadPerDay?: number;
}

export interface HandoverContext {
  aiActive: boolean;
  lastInboundText: string | null;
  qualification: Qualification;
  aiMessagesToday: number;
  lastInboundAt: Date | string | null;
  guardrails: AgentGuardrails;
  now?: Date;
}

export type HandoverReason =
  | 'ai_disabled'
  | 'outside_window'
  | 'daily_cap'
  | 'outside_working_hours'
  | 'human_requested'
  | 'negative_sentiment'
  | 'price_negotiation'
  | 'low_confidence';

export interface AgentDecision {
  shouldReply: boolean;
  handover: boolean;
  reason?: HandoverReason;
}

const HUMAN_REQUEST = /\b(agent|human|call me|baat kar|talk to|representative|salesperson|manager)\b/i;
const NEGOTIATION = /\b(discount|negotiat|lower price|best price|kam karo|offer|deal|rate kam)\b/i;

/**
 * Decide whether the AI should auto-reply or hand over to a human (FR-7).
 * Order matters: hard stops (disabled/window/cap/hours) first, then
 * content-driven handover triggers.
 */
export function decideAgentAction(ctx: HandoverContext): AgentDecision {
  const now = ctx.now ?? new Date();

  if (!ctx.aiActive) return { shouldReply: false, handover: false, reason: 'ai_disabled' };

  // Outside the 24h window the AI cannot free-form reply (templates are a
  // separate, human/marketing concern).
  if (!isWithinSessionWindow(ctx.lastInboundAt, now)) {
    return { shouldReply: false, handover: false, reason: 'outside_window' };
  }

  const cap = ctx.guardrails.maxAiMessagesPerLeadPerDay;
  if (cap != null && ctx.aiMessagesToday >= cap) {
    return { shouldReply: false, handover: false, reason: 'daily_cap' };
  }

  const wh = ctx.guardrails.workingHours;
  if (wh) {
    const hour = now.getHours();
    if (hour < wh.start || hour >= wh.end) {
      return { shouldReply: false, handover: false, reason: 'outside_working_hours' };
    }
  }

  const text = ctx.lastInboundText ?? '';
  if (HUMAN_REQUEST.test(text)) return { shouldReply: false, handover: true, reason: 'human_requested' };
  if (NEGOTIATION.test(text)) return { shouldReply: false, handover: true, reason: 'price_negotiation' };
  if (ctx.qualification.sentiment === 'neg')
    return { shouldReply: false, handover: true, reason: 'negative_sentiment' };
  if (ctx.qualification.confidence > 0 && ctx.qualification.confidence < 0.3)
    return { shouldReply: false, handover: true, reason: 'low_confidence' };

  return { shouldReply: true, handover: false };
}

/** Build the system prompt for the reply agent from persona + guardrails + RAG. */
export function buildAgentSystemPrompt(input: {
  guardrails: AgentGuardrails;
  qualification: Qualification;
  inventoryContext: string;
  detectedLanguage?: string | null;
}): string {
  const g = input.guardrails;
  const lines = [
    `You are a real-estate sales assistant on WhatsApp for an Indian agency.`,
    g.persona ? `Persona: ${g.persona}` : '',
    g.tone ? `Tone: ${g.tone}` : 'Tone: warm, concise, helpful.',
    `Reply in the SAME language the lead used${input.detectedLanguage ? ` (detected: ${input.detectedLanguage})` : ''}. Hinglish is fine if they used it.`,
    `NEVER invent prices, availability, or project details. Use ONLY the inventory context below; if unknown, say you'll check.`,
    g.topicsToAvoid?.length ? `Avoid these topics: ${g.topicsToAvoid.join(', ')}.` : '',
    `Collect missing qualification details naturally (don't interrogate). Offer a site visit when it fits.`,
    ``,
    `Known lead details: ${JSON.stringify(input.qualification)}`,
    ``,
    `Inventory context (the ONLY source of prices/availability):`,
    input.inventoryContext || '(no matching inventory found yet)',
  ];
  return lines.filter(Boolean).join('\n');
}
