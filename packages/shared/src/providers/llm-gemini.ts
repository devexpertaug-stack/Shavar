import {
  coerceQualification,
  estimateCostMicroUsd,
  QUALIFICATION_SYSTEM_PROMPT,
  type ChatMessage,
  type ChatResult,
  type ExtractResult,
  type LlmProvider,
} from '../llm';

export interface GeminiConfig {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Gemini LLM adapter using structured JSON output. extract() asks the model to
 * return the strict qualification JSON (§4.3), validated via Zod; chat() powers
 * the reply agent. Includes a timeout and bounded retries with backoff, and
 * reports token usage for llm_usage cost logging.
 */
export class GeminiLlmProvider implements LlmProvider {
  readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(private readonly config: GeminiConfig) {
    this.model = config.model ?? 'gemini-2.5-flash';
    this.timeoutMs = config.timeoutMs ?? 15_000;
    this.maxRetries = config.maxRetries ?? 2;
  }

  async extract(input: { conversation: string; inventoryContext?: string }): Promise<ExtractResult> {
    const prompt = [
      QUALIFICATION_SYSTEM_PROMPT,
      input.inventoryContext ? `\nInventory context:\n${input.inventoryContext}` : '',
      `\nConversation:\n${input.conversation}`,
    ].join('\n');

    const { text, usage } = await this.generate(prompt, { json: true });
    const qualification = coerceQualification(text);
    return { qualification, usage };
  }

  async chat(messages: ChatMessage[]): Promise<ChatResult> {
    const prompt = messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
    const { text, usage } = await this.generate(prompt, { json: false });
    return { text, usage };
  }

  private async generate(
    prompt: string,
    opts: { json: boolean },
  ): Promise<{ text: string; usage: ExtractResult['usage'] }> {
    const url = `${GEMINI_BASE}/${this.model}:generateContent?key=${this.config.apiKey}`;
    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: opts.json ? { responseMimeType: 'application/json' } : {},
    };

    let lastErr: Error | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
        const json = (await res.json()) as GeminiResponse;
        const text =
          json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
        const promptTokens = json.usageMetadata?.promptTokenCount ?? 0;
        const completionTokens = json.usageMetadata?.candidatesTokenCount ?? 0;
        return {
          text,
          usage: {
            model: this.model,
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
            costMicroUsd: estimateCostMicroUsd(promptTokens, completionTokens),
          },
        };
      } catch (err) {
        clearTimeout(timer);
        lastErr = err as Error;
        if (attempt < this.maxRetries) {
          await new Promise((r) => setTimeout(r, 300 * Math.pow(2, attempt)));
        }
      }
    }
    throw lastErr ?? new Error('Gemini request failed');
  }
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}
