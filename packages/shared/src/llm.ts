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

export const EMBEDDING_DIMS = 768;

export interface LlmProvider {
  readonly model: string;
  /** Extract qualification JSON from the conversation so far. */
  extract(input: { conversation: string; inventoryContext?: string }): Promise<ExtractResult>;
  /** Free-form chat completion (reply agent, Task 10). */
  chat(messages: ChatMessage[]): Promise<ChatResult>;
  /** Embed text into a fixed-dim vector for inventory matching (Task 9). */
  embed(text: string): Promise<number[]>;
}

/**
 * Deterministic hashing embedder (no API needed). Produces a stable, normalized
 * EMBEDDING_DIMS-length vector from text so similar strings land near each
 * other. Used by the mock provider and as a Gemini fallback for tests/dev.
 */
export function hashEmbed(text: string, dims = EMBEDDING_DIMS): number[] {
  const vec = new Array<number>(dims).fill(0);
  const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);
  for (const tok of tokens) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) {
      h ^= tok.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % dims;
    vec[idx] += 1;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
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
