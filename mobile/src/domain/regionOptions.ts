// Option lists for the time zone and currency dropdowns. Static so they work
// the same on every phone (Hermes has no Intl.supportedValuesOf); every value
// is one the API accepts (IANA zone / ISO 4217 code).

export interface SelectOption { value: string; label: string; detail?: string; keywords?: string }

const ZONES = [
  // Africa
  'Africa/Harare', 'Africa/Johannesburg', 'Africa/Lusaka', 'Africa/Maputo', 'Africa/Gaborone', 'Africa/Windhoek', 'Africa/Blantyre', 'Africa/Lubumbashi',
  'Africa/Nairobi', 'Africa/Kampala', 'Africa/Dar_es_Salaam', 'Africa/Addis_Ababa', 'Africa/Kigali', 'Africa/Lagos', 'Africa/Accra', 'Africa/Abidjan',
  'Africa/Dakar', 'Africa/Cairo', 'Africa/Casablanca', 'Africa/Algiers', 'Africa/Tunis', 'Africa/Khartoum', 'Africa/Luanda', 'Africa/Kinshasa', 'Africa/Douala',
  // Middle East & Asia
  'Asia/Dubai', 'Asia/Riyadh', 'Asia/Qatar', 'Asia/Kuwait', 'Asia/Bahrain', 'Asia/Muscat', 'Asia/Jerusalem', 'Asia/Amman', 'Asia/Beirut', 'Asia/Baghdad', 'Asia/Tehran',
  'Asia/Karachi', 'Asia/Kolkata', 'Asia/Colombo', 'Asia/Dhaka', 'Asia/Kathmandu', 'Asia/Bangkok', 'Asia/Jakarta', 'Asia/Ho_Chi_Minh', 'Asia/Kuala_Lumpur',
  'Asia/Singapore', 'Asia/Manila', 'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Taipei', 'Asia/Seoul', 'Asia/Tokyo',
  // Europe
  'Europe/London', 'Europe/Dublin', 'Europe/Lisbon', 'Europe/Paris', 'Europe/Madrid', 'Europe/Berlin', 'Europe/Amsterdam', 'Europe/Brussels', 'Europe/Zurich',
  'Europe/Rome', 'Europe/Vienna', 'Europe/Stockholm', 'Europe/Oslo', 'Europe/Copenhagen', 'Europe/Warsaw', 'Europe/Prague', 'Europe/Athens', 'Europe/Bucharest',
  'Europe/Helsinki', 'Europe/Kyiv', 'Europe/Istanbul', 'Europe/Moscow',
  // Americas
  'America/New_York', 'America/Toronto', 'America/Chicago', 'America/Mexico_City', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Vancouver',
  'America/Anchorage', 'America/Halifax', 'America/Bogota', 'America/Lima', 'America/Caracas', 'America/Santiago', 'America/Sao_Paulo', 'America/Buenos_Aires',
  'America/Jamaica', 'America/Port_of_Spain',
  // Oceania & other
  'Australia/Perth', 'Australia/Adelaide', 'Australia/Brisbane', 'Australia/Sydney', 'Australia/Melbourne', 'Pacific/Auckland', 'Pacific/Fiji', 'Pacific/Honolulu',
  'Indian/Mauritius', 'Atlantic/Reykjavik', 'UTC',
];

function offsetOf(zone: string): string | undefined {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName');
    return part?.value?.replace('GMT', 'UTC') || undefined;
  } catch {
    return undefined;
  }
}

export function timezoneOptions(): SelectOption[] {
  return ZONES.map((zone) => {
    const [region, ...rest] = zone.split('/');
    const city = (rest.join(' / ') || region).replace(/_/g, ' ');
    return { value: zone, label: city, detail: [region === city ? undefined : region, offsetOf(zone)].filter(Boolean).join(' · '), keywords: zone };
  });
}

export const CURRENCIES: SelectOption[] = [
  ['USD', 'US Dollar'], ['ZWG', 'Zimbabwe Gold'], ['ZAR', 'South African Rand'], ['BWP', 'Botswana Pula'], ['ZMW', 'Zambian Kwacha'], ['MZN', 'Mozambican Metical'],
  ['NAD', 'Namibian Dollar'], ['MWK', 'Malawian Kwacha'], ['KES', 'Kenyan Shilling'], ['UGX', 'Ugandan Shilling'], ['TZS', 'Tanzanian Shilling'], ['RWF', 'Rwandan Franc'],
  ['ETB', 'Ethiopian Birr'], ['NGN', 'Nigerian Naira'], ['GHS', 'Ghanaian Cedi'], ['XOF', 'West African CFA Franc'], ['XAF', 'Central African CFA Franc'],
  ['EGP', 'Egyptian Pound'], ['MAD', 'Moroccan Dirham'], ['AOA', 'Angolan Kwanza'], ['CDF', 'Congolese Franc'], ['MUR', 'Mauritian Rupee'],
  ['EUR', 'Euro'], ['GBP', 'British Pound'], ['CHF', 'Swiss Franc'], ['SEK', 'Swedish Krona'], ['NOK', 'Norwegian Krone'], ['DKK', 'Danish Krone'], ['PLN', 'Polish Zloty'],
  ['TRY', 'Turkish Lira'], ['AED', 'UAE Dirham'], ['SAR', 'Saudi Riyal'], ['QAR', 'Qatari Riyal'], ['KWD', 'Kuwaiti Dinar'], ['BHD', 'Bahraini Dinar'], ['OMR', 'Omani Rial'],
  ['ILS', 'Israeli Shekel'], ['INR', 'Indian Rupee'], ['PKR', 'Pakistani Rupee'], ['BDT', 'Bangladeshi Taka'], ['LKR', 'Sri Lankan Rupee'], ['CNY', 'Chinese Yuan'],
  ['HKD', 'Hong Kong Dollar'], ['JPY', 'Japanese Yen'], ['KRW', 'South Korean Won'], ['SGD', 'Singapore Dollar'], ['MYR', 'Malaysian Ringgit'], ['IDR', 'Indonesian Rupiah'],
  ['THB', 'Thai Baht'], ['PHP', 'Philippine Peso'], ['VND', 'Vietnamese Dong'], ['AUD', 'Australian Dollar'], ['NZD', 'New Zealand Dollar'], ['CAD', 'Canadian Dollar'],
  ['MXN', 'Mexican Peso'], ['BRL', 'Brazilian Real'], ['ARS', 'Argentine Peso'], ['CLP', 'Chilean Peso'], ['COP', 'Colombian Peso'], ['PEN', 'Peruvian Sol'], ['JMD', 'Jamaican Dollar'],
].map(([value, label]) => ({ value, label: `${value} · ${label}`, keywords: label }));

/** BCP 47 codes (2-10 chars, as the API accepts); Zimbabwe's main languages first. */
export const LANGUAGES: SelectOption[] = [
  ['en', 'English'], ['sn', 'Shona', 'chiShona'], ['nd', 'Ndebele', 'isiNdebele'], ['zu', 'Zulu', 'isiZulu'], ['xh', 'Xhosa', 'isiXhosa'], ['af', 'Afrikaans'],
  ['ny', 'Chichewa', 'Chinyanja'], ['tn', 'Tswana', 'Setswana'], ['st', 'Sotho', 'Sesotho'], ['sw', 'Swahili', 'Kiswahili'], ['pt', 'Portuguese', 'Português'],
  ['fr', 'French', 'Français'], ['es', 'Spanish', 'Español'], ['de', 'German', 'Deutsch'], ['it', 'Italian', 'Italiano'], ['nl', 'Dutch', 'Nederlands'],
  ['ar', 'Arabic', 'العربية'], ['hi', 'Hindi', 'हिन्दी'], ['ur', 'Urdu', 'اردو'], ['zh', 'Chinese', '中文'], ['ja', 'Japanese', '日本語'], ['ko', 'Korean', '한국어'],
  ['ru', 'Russian', 'Русский'], ['tr', 'Turkish', 'Türkçe'], ['am', 'Amharic', 'አማርኛ'], ['yo', 'Yoruba', 'Yorùbá'], ['ha', 'Hausa'], ['ig', 'Igbo'],
].map(([value, label, native]) => ({ value, label, detail: native, keywords: `${native ?? ''} ${value}` }));
