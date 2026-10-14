import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

/**
 * Normalize a phone number to E.164 (FR-3). Dedup keys on this value. The
 * default region is India (the target market); numbers already in
 * international form (+…) are parsed regardless of region.
 */
export function normalizePhoneE164(input: string, defaultCountry: CountryCode = 'IN'): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  const parsed = parsePhoneNumberFromString(trimmed, defaultCountry);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number; // E.164, e.g. +919812345678
}

/** Like normalizePhoneE164 but throws a descriptive error on invalid input. */
export function requirePhoneE164(input: string, defaultCountry: CountryCode = 'IN'): string {
  const e164 = normalizePhoneE164(input, defaultCountry);
  if (!e164) throw new Error(`Invalid phone number: ${input}`);
  return e164;
}
