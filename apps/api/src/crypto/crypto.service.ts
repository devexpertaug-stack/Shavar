import { Injectable } from '@nestjs/common';
import { decryptJson, encryptJson, loadEncryptionKey } from '@estateflow/shared';

/**
 * Thin wrapper that loads ENCRYPTION_KEY lazily and encrypts/decrypts configs.
 * Lazy so the app can boot without the key configured; the error only surfaces
 * when encryption is actually used.
 */
@Injectable()
export class CryptoService {
  private _key?: Buffer;

  private get key(): Buffer {
    if (!this._key) this._key = loadEncryptionKey(process.env.ENCRYPTION_KEY);
    return this._key;
  }

  encrypt(value: unknown): string {
    return encryptJson(this.key, value);
  }

  decrypt<T = unknown>(blob: string): T {
    return decryptJson<T>(this.key, blob);
  }
}
