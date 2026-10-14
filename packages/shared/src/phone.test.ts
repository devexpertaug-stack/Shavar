import { describe, it, expect } from 'vitest';
import { normalizePhoneE164, requirePhoneE164 } from './phone';

describe('normalizePhoneE164', () => {
  it('normalizes a local Indian 10-digit number', () => {
    expect(normalizePhoneE164('9812345678')).toBe('+919812345678');
  });

  it('normalizes a number with the 0 trunk prefix', () => {
    expect(normalizePhoneE164('09812345678')).toBe('+919812345678');
  });

  it('normalizes variants of the same number to one E.164 value (dedup key)', () => {
    const variants = ['+91 98123 45678', '098123-45678', '9812345678', '+919812345678'];
    const normalized = variants.map((v) => normalizePhoneE164(v));
    expect(new Set(normalized).size).toBe(1);
    expect(normalized[0]).toBe('+919812345678');
  });

  it('parses an already-international number regardless of default region', () => {
    expect(normalizePhoneE164('+14155552671', 'IN')).toBe('+14155552671');
  });

  it('returns null for invalid input', () => {
    expect(normalizePhoneE164('')).toBeNull();
    expect(normalizePhoneE164('123')).toBeNull();
    expect(normalizePhoneE164('not a phone')).toBeNull();
  });

  it('requirePhoneE164 throws on invalid input', () => {
    expect(() => requirePhoneE164('123')).toThrow(/Invalid phone/);
  });
});
