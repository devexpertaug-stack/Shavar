import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM encryption for provider credentials at rest (PRD §5).
 *
 * The key comes from ENCRYPTION_KEY (base64, 32 bytes). Ciphertext is encoded
 * as base64 of: iv(12) || authTag(16) || ciphertext. Decryption verifies the
 * auth tag, so tampering is detected.
 */

const IV_LENGTH = 12; // GCM standard nonce length
const TAG_LENGTH = 16;

export function loadEncryptionKey(raw: string | undefined): Buffer {
  if (!raw) throw new Error('ENCRYPTION_KEY is not set');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(`ENCRYPTION_KEY must decode to 32 bytes (got ${key.length})`);
  }
  return key;
}

export function encryptJson(key: Buffer, value: unknown): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decryptJson<T = unknown>(key: Buffer, blob: string): T {
  const data = Buffer.from(blob, 'base64');
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8')) as T;
}

/** Generate a fresh base64 32-byte key (used in docs/dev tooling). */
export function generateEncryptionKey(): string {
  return randomBytes(32).toString('base64');
}
