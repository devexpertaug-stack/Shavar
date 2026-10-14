import { describe, it, expect } from 'vitest';
import {
  encryptJson,
  decryptJson,
  loadEncryptionKey,
  generateEncryptionKey,
} from './crypto';

describe('AES-256-GCM credential encryption', () => {
  const key = loadEncryptionKey(generateEncryptionKey());

  it('round-trips a JSON object', () => {
    const secret = { apiKey: 'wati-123', baseUrl: 'https://live.wati.io', webhookSecret: 's3cret' };
    const blob = encryptJson(key, secret);
    expect(blob).not.toContain('wati-123'); // not plaintext
    expect(decryptJson(key, blob)).toEqual(secret);
  });

  it('produces different ciphertext each time (random IV)', () => {
    const a = encryptJson(key, { x: 1 });
    const b = encryptJson(key, { x: 1 });
    expect(a).not.toBe(b);
    expect(decryptJson(key, a)).toEqual(decryptJson(key, b));
  });

  it('fails to decrypt when the ciphertext is tampered (auth tag)', () => {
    const blob = encryptJson(key, { x: 1 });
    const bytes = Buffer.from(blob, 'base64');
    bytes[bytes.length - 1] ^= 0xff; // flip a byte in the ciphertext
    expect(() => decryptJson(key, bytes.toString('base64'))).toThrow();
  });

  it('fails to decrypt with the wrong key', () => {
    const blob = encryptJson(key, { x: 1 });
    const otherKey = loadEncryptionKey(generateEncryptionKey());
    expect(() => decryptJson(otherKey, blob)).toThrow();
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => loadEncryptionKey(Buffer.from('short').toString('base64'))).toThrow(/32 bytes/);
  });
});
