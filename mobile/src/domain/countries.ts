import { COUNTRIES, MAIN_COUNTRY_FOR_DIAL, type RegionCountry } from './regionData.generated';

// Every country the API's phone validation (libphonenumber) knows, so a number
// from anywhere can be entered. Launch markets come first in the picker.
export type Country = RegionCountry;
export { COUNTRIES };

const byCode = new Map(COUNTRIES.map((country) => [country.code, country]));
// Longest calling code first so "+1242..." style prefixes and "+263" never lose to "+2".
const byDialLength = COUNTRIES.slice().sort((a, b) => b.dial.length - a.dial.length);

export const countryByCode = (code: string | null | undefined): Country | undefined => (code ? byCode.get(code.toUpperCase()) : undefined);

export const countryFlag = (code: string) => String.fromCodePoint(...code.toUpperCase().split('').map((letter) => 127397 + letter.charCodeAt(0)));

/**
 * Picks the country for an international number. Many countries share one
 * calling code (+1 US/Canada/Caribbean, +44 UK/Jersey/Isle of Man, +7 Russia/Kazakhstan),
 * so the caller's own country wins when it uses that code, otherwise the code's
 * main country (US, GB, RU ...). Falls back to `fallbackCode`, then Zimbabwe.
 */
export function countryForPhone(value: string, fallbackCode = 'ZW'): Country {
  const fallback = countryByCode(fallbackCode) ?? COUNTRIES[0]!;
  if (!value.startsWith('+')) return fallback;
  const match = byDialLength.find((country) => value.startsWith(country.dial));
  if (!match) return fallback;
  if (fallback.dial === match.dial) return fallback;
  return countryByCode(MAIN_COUNTRY_FOR_DIAL[match.dial]) ?? match;
}

/** National number digits to E.164: calling code + digits with leading zeros dropped. */
export const normalizePhone = (dial: string, local: string) => `${dial}${local.replace(/\D/g, '').replace(/^0+/, '')}`;

/** Case- and accent-insensitive match on name, ISO code or calling code ("+263", "263", "zimb"). */
export function searchCountries(query: string): Country[] {
  const needle = query.trim().toLowerCase().replace(/^\+/, '');
  if (!needle) return COUNTRIES;
  const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const folded = fold(needle);
  return COUNTRIES.filter((country) => fold(country.name).includes(folded) || country.code.toLowerCase() === folded || country.dial.slice(1).startsWith(folded));
}
