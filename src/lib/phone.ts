import { parsePhoneNumberFromString, isSupportedCountry, type CountryCode } from "libphonenumber-js";

export interface PhoneParseResult {
  valid: boolean;
  e164: string | null;
  country: CountryCode | null;
}

/**
 * Best-effort, never-throws phone parsing. A bare local number (e.g.
 * "0771234567") can only resolve to E.164 when `defaultCountry` is
 * supplied — without it, only already-international numbers ("+263…") can
 * be normalized. This never rejects a caller's write; it's the caller's
 * job to decide what to do with an invalid result (see `toE164OrNull`,
 * which every current call site uses to store null on the derived field
 * rather than fail the request).
 */
export function parsePhoneNumber(raw: string, defaultCountry?: CountryCode | null): PhoneParseResult {
  const trimmed = raw.trim();
  if (!trimmed) return { valid: false, e164: null, country: null };

  let parsed;
  try {
    parsed = parsePhoneNumberFromString(trimmed, defaultCountry ?? undefined);
  } catch {
    return { valid: false, e164: null, country: null };
  }

  if (!parsed || !parsed.isValid()) {
    return { valid: false, e164: null, country: parsed?.country ?? null };
  }

  return { valid: true, e164: parsed.number, country: parsed.country ?? null };
}

/**
 * Returns the E.164 form of `raw` when it parses as valid, otherwise null.
 * Used to populate the opportunistic `phoneE164` fields on Business and
 * Customer — never throws, never blocks a write, and leaves the existing
 * freeform `phone` field completely untouched.
 */
export function toE164OrNull(raw: string | null | undefined, defaultCountry?: CountryCode | null): string | null {
  if (!raw) return null;
  return parsePhoneNumber(raw, defaultCountry).e164;
}

/** True when `code` is a real ISO 3166-1 alpha-2 country libphonenumber recognizes. */
export function isValidCountryCode(code: string): code is CountryCode {
  return isSupportedCountry(code);
}
