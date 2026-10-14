import { describe, it, expect } from 'vitest';
import { MockSttProvider, GeminiSttProvider, createSttProvider } from './stt';

describe('STT providers', () => {
  it('mock returns a deterministic transcript', async () => {
    const r = await new MockSttProvider('hello wakad').transcribe({ audio: Buffer.from(''), mimeType: 'audio/ogg' });
    expect(r.transcript).toBe('hello wakad');
  });

  it('gemini falls back gracefully when the API is unreachable', async () => {
    const g = new GeminiSttProvider('invalid-key');
    const r = await g.transcribe({ audio: Buffer.from('x'), mimeType: 'audio/ogg' });
    // No network in tests => fallback marker, never throws.
    expect(typeof r.transcript).toBe('string');
    expect(r.transcript.length).toBeGreaterThan(0);
  });

  it('factory returns mock without a Gemini key', () => {
    expect(createSttProvider({ STT_PROVIDER: 'gemini' } as NodeJS.ProcessEnv).name).toBe('mock-stt');
    expect(createSttProvider({ STT_PROVIDER: 'mock' } as NodeJS.ProcessEnv).name).toBe('mock-stt');
  });
});
