import { emptyQualification, type Qualification } from '../qualification';
import {
  estimateCostMicroUsd,
  hashEmbed,
  type ChatMessage,
  type ChatResult,
  type ExtractResult,
  type LlmProvider,
} from '../llm';

/**
 * Deterministic rule-based LLM mock for dev/tests. It approximates extraction
 * well enough for a golden-set of English/Hinglish samples without an API key.
 */
export class MockLlmProvider implements LlmProvider {
  readonly model = 'mock-extract-v1';

  async extract(input: { conversation: string }): Promise<ExtractResult> {
    const q = ruleExtract(input.conversation);
    const promptTokens = Math.ceil(input.conversation.length / 4);
    const completionTokens = 60;
    return {
      qualification: q,
      usage: {
        model: this.model,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        costMicroUsd: 0,
      },
    };
  }

  async chat(messages: ChatMessage[]): Promise<ChatResult> {
    const last = [...messages].reverse().find((m) => m.role === 'user');
    const text = `Thanks for your message! ${last ? 'How can I help further?' : ''}`.trim();
    return {
      text,
      usage: {
        model: this.model,
        promptTokens: 20,
        completionTokens: 10,
        totalTokens: 30,
        costMicroUsd: estimateCostMicroUsd(20, 10),
      },
    };
  }

  async embed(text: string): Promise<number[]> {
    return hashEmbed(text);
  }
}

/** Shared rule-based extractor (also used by the Gemini fallback on failure). */
export function ruleExtract(text: string): Qualification {
  const q = emptyQualification();
  const lower = text.toLowerCase();

  if (/\b(rent|kiraya|lease)\b/.test(lower)) q.intent = 'rent';
  else if (/\b(invest|investment)\b/.test(lower)) q.intent = 'invest';
  else if (/\b(sell|bech)\b/.test(lower)) q.intent = 'sell';
  else if (/\b(buy|chahiye|lena|kharid|purchase|want|looking)\b/.test(lower)) q.intent = 'buy';

  const bhk = lower.match(/(\d+)\s*bhk/);
  if (bhk) q.bhk = Number(bhk[1]);

  // Budgets: "70 lakh", "1.2 cr/crore", bare numbers.
  const lakh = lower.match(/(\d+(?:\.\d+)?)\s*(?:lakh|lac|lkh|l\b)/);
  const crore = lower.match(/(\d+(?:\.\d+)?)\s*(?:crore|cr\b)/);
  if (crore) q.budget_max = Math.round(Number(crore[1]) * 1_00_00_000);
  else if (lakh) q.budget_max = Math.round(Number(lakh[1]) * 1_00_000);
  if (q.budget_max) q.budget_min = Math.round(q.budget_max * 0.8);

  // Locations: common Pune localities + "in <Place>" / "<Place> me".
  const KNOWN = ['wakad', 'hinjewadi', 'baner', 'kothrud', 'aundh', 'kharadi', 'wagholi', 'ravet'];
  for (const loc of KNOWN) {
    if (lower.includes(loc)) q.locations.push(loc.charAt(0).toUpperCase() + loc.slice(1));
  }

  if (/\b(0-3|3 month|3 mahine|3 mo|immediately|urgent|turant|asap|this month)\b/.test(lower))
    q.timeline = '0-3m';
  else if (/\b(3-6|6 month|6 mahine)\b/.test(lower)) q.timeline = '3-6m';
  else if (/\b(next year|6m\+|6\+ month|baad me)\b/.test(lower)) q.timeline = '6m+';

  if (/\b(loan|emi|home loan|finance)\b/.test(lower)) q.financing = 'loan';
  else if (/\b(cash|full payment|outright)\b/.test(lower)) q.financing = 'cash';

  if (/\b(visit|site visit|dekh|dekhna|see the|tour|dekhne)\b/.test(lower))
    q.site_visit_interest = true;

  if (/\b(great|good|interested|love|perfect|accha|badhiya|haan)\b/.test(lower)) q.sentiment = 'pos';
  else if (/\b(expensive|costly|not interested|bad|mehenga|nahi chahiye)\b/.test(lower))
    q.sentiment = 'neg';

  if (/price|rate|cost|kitne ka|kitna/.test(lower)) q.urgency_signals.push('asked about price');

  // Confidence scales with how many fields we filled.
  const filled = [q.bhk, q.budget_max, q.locations.length, q.timeline !== 'unknown'].filter(
    Boolean,
  ).length;
  q.confidence = Math.min(1, 0.4 + filled * 0.15);

  if (/\b(viagra|loan offer|click here|http|crypto|bitcoin)\b/.test(lower)) {
    q.intent = 'spam';
    q.confidence = 0.9;
  }
  return q;
}
