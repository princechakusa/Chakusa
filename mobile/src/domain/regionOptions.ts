// Option lists for the time zone and currency dropdowns. Static so they work
// the same on every phone (Hermes has no Intl.supportedValuesOf); every value
// is one the API accepts (IANA zone / ISO 4217 code).

import { CURRENCY_ENTRIES, ZONE_NAMES } from './regionData.generated';

export interface SelectOption { value: string; label: string; detail?: string; keywords?: string; /** Shown in the closed field when space is tight. */ short?: string }

// Every IANA zone and ISO 4217 currency, generated from Node's ICU data
// (scripts/generate-region-data.mjs): launch markets first, then A-Z.
const ZONES = ZONE_NAMES;

function offsetOf(zone: string): string | undefined {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName');
    return part?.value?.replace('GMT', 'UTC') || undefined;
  } catch {
    return undefined;
  }
}

let cachedZones: SelectOption[] | undefined;
/** Built on first use (not at import): offsets for ~420 zones cost a few ms each on Hermes. */
export function timezoneOptions(): SelectOption[] {
  cachedZones ??= ZONES.map((zone) => {
    const [region, ...rest] = zone.split('/');
    const city = (rest.join(' / ') || region).replace(/_/g, ' ');
    return { value: zone, label: city, detail: [region === city ? undefined : region, offsetOf(zone)].filter(Boolean).join(' · '), keywords: zone };
  });
  return cachedZones;
}

export const CURRENCIES: SelectOption[] = CURRENCY_ENTRIES.map(([value, label]) => ({ value, label: `${value} · ${label}`, keywords: label, short: value }));

/** BCP 47 codes (2-10 chars, as the API accepts); Zimbabwe's main languages first. */
export const LANGUAGES: SelectOption[] = [
  ['en', 'English'], ['sn', 'Shona', 'chiShona'], ['nd', 'Ndebele', 'isiNdebele'], ['zu', 'Zulu', 'isiZulu'], ['xh', 'Xhosa', 'isiXhosa'], ['af', 'Afrikaans'],
  ['ny', 'Chichewa', 'Chinyanja'], ['tn', 'Tswana', 'Setswana'], ['st', 'Sotho', 'Sesotho'], ['sw', 'Swahili', 'Kiswahili'], ['pt', 'Portuguese', 'Português'],
  ['fr', 'French', 'Français'], ['es', 'Spanish', 'Español'], ['de', 'German', 'Deutsch'], ['it', 'Italian', 'Italiano'], ['nl', 'Dutch', 'Nederlands'],
  ['ar', 'Arabic', 'العربية'], ['hi', 'Hindi', 'हिन्दी'], ['ur', 'Urdu', 'اردو'], ['zh', 'Chinese', '中文'], ['ja', 'Japanese', '日本語'], ['ko', 'Korean', '한국어'],
  ['ru', 'Russian', 'Русский'], ['tr', 'Turkish', 'Türkçe'], ['am', 'Amharic', 'አማርኛ'], ['yo', 'Yoruba', 'Yorùbá'], ['ha', 'Hausa'], ['ig', 'Igbo'],
].map(([value, label, native]) => ({ value, label, detail: native, keywords: `${native ?? ''} ${value}` }));
