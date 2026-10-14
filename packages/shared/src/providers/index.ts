import type { WhatsAppProviderType } from '../enums';
import type { ProviderConfig, WhatsAppProvider } from '../whatsapp';
import { MockWhatsAppProvider } from './mock';
import { WatiProvider } from './wati';
import { AiSensyProvider } from './aisensy';

export { MockWhatsAppProvider } from './mock';
export { WatiProvider } from './wati';
export { AiSensyProvider } from './aisensy';

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
