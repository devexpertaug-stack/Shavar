/**
 * Speech-to-text adapter (PRD §4.2 / FR-6, Task 11). Voice notes are
 * transcribed, then handled like text in the same pipeline.
 */
export interface SttResult {
  transcript: string;
  language?: string | null;
}

export interface SttProvider {
  readonly name: string;
  transcribe(input: { audio: Buffer; mimeType: string }): Promise<SttResult>;
}

/** Deterministic mock STT for dev/tests (no audio decoding). */
export class MockSttProvider implements SttProvider {
  readonly name = 'mock-stt';
  constructor(private readonly fixed = '[voice note]') {}
  async transcribe(): Promise<SttResult> {
    return { transcript: this.fixed, language: 'en' };
  }
}

/** Gemini audio transcription; returns a safe fallback marker on failure. */
export class GeminiSttProvider implements SttProvider {
  readonly name = 'gemini-stt';
  constructor(
    private readonly apiKey: string,
    private readonly model = 'gemini-2.5-flash',
  ) {}

  async transcribe(input: { audio: Buffer; mimeType: string }): Promise<SttResult> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: 'Transcribe this audio verbatim. Return only the transcript text.' },
                { inlineData: { mimeType: input.mimeType, data: input.audio.toString('base64') } },
              ],
            },
          ],
        }),
      });
      if (!res.ok) throw new Error(`Gemini STT HTTP ${res.status}`);
      const json = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const transcript = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim();
      return { transcript: transcript || '[inaudible voice note]' };
    } catch {
      return { transcript: '[voice note — transcription unavailable]' };
    }
  }
}

export function createSttProvider(env: NodeJS.ProcessEnv = process.env): SttProvider {
  if ((env.STT_PROVIDER ?? 'mock').toLowerCase() === 'gemini' && env.GEMINI_API_KEY) {
    return new GeminiSttProvider(env.GEMINI_API_KEY, env.LLM_MODEL);
  }
  return new MockSttProvider();
}
