import { QualificationSchema, type Qualification } from './qualification';

/**
 * LLM adapter contract (PRD §6). The agent only *extracts* structured fields;
 * scoring is deterministic code (FR-9). extract() must return data matching the
 * strict qualification schema (§4.3). chat() powers the Task 10 reply agent.
 */

export interface LlmUsage {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Estimated cost in micro-USD (1e-6 USD) to avoid float drift. */
  costMicroUsd: number;
}

export interface ExtractResult {
  qualification: Qualification;
  usage: LlmUsage;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
export interface ChatResult {
  text: string;
  usage: LlmUsage;
}

export interface LlmProvider {
  readonly model: string;
  /** Extract qualification JSON from the conversation so far. */
  extract(input: { conversation: string; inventoryContext?: string }): Promise<ExtractResult>;
  /** Free-form chat completion (reply agent, Task 10). */
  chat(messages: ChatMessage[]): Promise<ChatResult>;
}

/**
 * Coerce arbitrary LLM JSON output into the strict qualification schema.
 * Tolerates missing/extra keys; invalid payloads throw (callers log + retry).
 */
export function coerceQualification(raw: unknown): Qualification {
  const obj = typeof raw === 'string' ? safeJson(raw) : raw;
  return QualificationSchema.parse(obj ?? {});
}

function safeJson(s: string): unknown {
  // Strip markdown code fences the model sometimes wraps JSON in.
  const cleaned = s
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Last resort: grab the first {...} block.
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('LLM did not return valid JSON');
  }
}

/** Rough Gemini 2.5 Flash pricing for cost logging (micro-USD per token). */
export const GEMINI_FLASH_PRICING = {
  inputPerMillionUsd: 0.3,
  outputPerMillionUsd: 2.5,
};

export function estimateCostMicroUsd(
  promptTokens: number,
  completionTokens: number,
  pricing = GEMINI_FLASH_PRICING,
): number {
  const usd =
    (promptTokens / 1_000_000) * pricing.inputPerMillionUsd +
    (completionTokens / 1_000_000) * pricing.outputPerMillionUsd;
  return Math.round(usd * 1_000_000);
}

/** The system prompt instructing the model to emit strict qualification JSON. */
export const QUALIFICATION_SYSTEM_PROMPT = `You are a real-estate lead qualification engine for an Indian property CRM.
Read the WhatsApp conversation and extract the lead's intent and details.
Respond with ONLY a JSON object, no prose, matching exactly these keys:
{"intent":"buy|rent|invest|sell|browsing|spam","property_type":string|null,"bhk":number|null,"budget_min":number|null,"budget_max":number|null,"locations":string[],"timeline":"0-3m|3-6m|6m+|unknown","financing":"loan|cash|unknown","site_visit_interest":boolean,"sentiment":"pos|neu|neg","urgency_signals":string[],"next_question":string|null,"confidence":number}
Budgets are in INR (e.g. "70 lakh" => 7000000, "1.2 cr" => 12000000). Understand Hindi/Hinglish. confidence is 0..1.`;
