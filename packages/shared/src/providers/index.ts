import type { WhatsAppProviderType } from '../enums';
import type { ProviderConfig, WhatsAppProvider } from '../whatsapp';
import { MockWhatsAppProvider } from './mock';
import { WatiProvider } from './wati';
import { AiSensyProvider } from './aisensy';

export { MockWhatsAppProvider } from './mock';
export { WatiProvider } from './wati';
export { AiSensyProvider } from './aisensy';
export { MockLlmProvider, ruleExtract } from './llm-mock';
export { GeminiLlmProvider } from './llm-gemini';

import type { LlmProvider } from '../llm';
import { MockLlmProvider } from './llm-mock';
import { GeminiLlmProvider } from './llm-gemini';

/** Build an LLM provider from env (LLM_PROVIDER / GEMINI_API_KEY). */
export function createLlmProvider(env: NodeJS.ProcessEnv = process.env): LlmProvider {
  const provider = (env.LLM_PROVIDER ?? 'mock').toLowerCase();
  if (provider === 'gemini' && env.GEMINI_API_KEY) {
    return new GeminiLlmProvider({ apiKey: env.GEMINI_API_KEY, model: env.LLM_MODEL });
  }
  return new MockLlmProvider();
}

/** Build a provider adapter from a decrypted per-tenant config. */
export function createWhatsAppProvider(config: ProviderConfig): WhatsAppProvider {
  switch (config.type) {
    case 'WATI':
      return new WatiProvider(config);
    case 'AISENSY':
    case 'META_CLOUD':
      // Meta Cloud shares AiSensy's webhook shape (AiSensy resells Cloud API).
      return new AiSensyProvider(config);
    case 'MOCK':
      return new MockWhatsAppProvider();
    default: {
      const _exhaustive: never = config.type;
      throw new Error(`Unsupported provider: ${String(_exhaustive)}`);
    }
  }
}

export function providerFromType(type: WhatsAppProviderType, config: ProviderConfig): WhatsAppProvider {
  return createWhatsAppProvider({ ...config, type });
}
