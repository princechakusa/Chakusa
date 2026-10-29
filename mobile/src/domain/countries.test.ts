import { describe, expect, it } from 'vitest';
import { COUNTRIES, countryByCode, countryFlag, countryForPhone, normalizePhone, searchCountries } from './countries';
import { CURRENCIES, timezoneOptions } from './regionOptions';

const AFRICA = ['ZW', 'ZA', 'BW', 'ZM', 'MZ', 'NA', 'MW', 'KE', 'UG', 'TZ', 'RW', 'ET', 'NG', 'GH', 'EG', 'MA', 'DZ', 'TN', 'SN', 'CI', 'CM', 'AO', 'CD', 'CG', 'SD', 'LY', 'MU', 'SZ', 'LS', 'MG', 'SO', 'ML', 'BF', 'NE', 'TD', 'GA', 'GN', 'BJ', 'TG', 'SL', 'LR', 'GM', 'ER', 'DJ', 'BI', 'SS', 'CV', 'SC', 'KM', 'MR', 'GQ', 'GW', 'ST', 'CF'];
const EU = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'];
const ASIA = ['CN', 'JP', 'KR', 'IN', 'PK', 'BD', 'LK', 'NP', 'ID', 'MY', 'SG', 'TH', 'VN', 'PH', 'KH', 'LA', 'MM', 'MN', 'KZ', 'UZ', 'AF', 'IR', 'IQ', 'JO', 'LB', 'IL', 'TR', 'AE', 'SA', 'QA', 'KW', 'BH', 'OM', 'YE', 'TW', 'HK', 'BT', 'MV'];
const AMERICAS = ['US', 'CA', 'MX', 'GT', 'HN', 'SV', 'NI', 'CR', 'PA', 'CU', 'DO', 'HT', 'JM', 'TT', 'BS', 'BB', 'CO', 'VE', 'EC', 'PE', 'BO', 'CL', 'AR', 'UY', 'PY', 'BR', 'GY', 'SR'];

describe('country list', () => {
  it('has every country once, with a valid ISO code and dial code', () => {
    const codes = COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(COUNTRIES.length).toBeGreaterThan(230);
    for (const c of COUNTRIES) {
      expect(c.code).toMatch(/^[A-Z]{2}$/);
      expect(c.dial).toMatch(/^\+\d{1,4}$/);
      expect(c.name.length).toBeGreaterThan(1);
    }
  });

  it('covers Africa, the EU, Asia and the Americas', () => {
    for (const code of [...AFRICA, ...EU, ...ASIA, ...AMERICAS]) expect(countryByCode(code), code).toBeDefined();
  });

  it('puts launch markets first, Zimbabwe at the top', () => {
    expect(COUNTRIES[0]?.code).toBe('ZW');
    expect(COUNTRIES.slice(0, 16).map((c) => c.code)).toEqual(expect.arrayContaining(['ZA', 'KE', 'NG']));
  });

  it('builds flags from ISO codes', () => {
    expect(countryFlag('zw')).toBe('🇿🇼');
    expect(countryFlag('FR')).toBe('🇫🇷');
  });
});

describe('resolving a number to a country', () => {
  it('uses the longest matching calling code', () => {
    expect(countryForPhone('+263771234567').code).toBe('ZW');
    expect(countryForPhone('+27821234567', 'ZW').code).toBe('ZA');
    expect(countryForPhone('+971581852582', 'ZW').code).toBe('AE');
    expect(countryForPhone('+353851234567', 'ZW').code).toBe('IE');
  });

  it("prefers the caller's own country on a shared calling code, otherwise the main one", () => {
    expect(countryForPhone('+14155550123', 'CA').code).toBe('CA');
    expect(countryForPhone('+14155550123', 'ZW').code).toBe('US');
    expect(countryForPhone('+447911123456', 'JE').code).toBe('JE');
    expect(countryForPhone('+447911123456', 'ZW').code).toBe('GB');
    expect(countryForPhone('+77011234567', 'ZW').code).toBe('RU');
  });

  it('falls back when the number is local or unknown', () => {
    expect(countryForPhone('0771234567', 'KE').code).toBe('KE');
    expect(countryForPhone('', 'XX').code).toBe('ZW');
  });

  it('normalizes to E.164 by dropping leading zeros', () => {
    expect(normalizePhone('+263', '0771 234 567')).toBe('+263771234567');
    expect(normalizePhone('+44', '(0)7911-123456')).toBe('+447911123456');
  });
});

describe('country search', () => {
  it('matches name, ISO code and calling code, ignoring case and accents', () => {
    expect(searchCountries('zimb').map((c) => c.code)).toContain('ZW');
    expect(searchCountries('+263').map((c) => c.code)).toContain('ZW');
    expect(searchCountries('263')[0]?.code).toBe('ZW');
    expect(searchCountries('ke').map((c) => c.code)).toContain('KE');
    expect(searchCountries("cote d'ivoire").map((c) => c.code)).toContain('CI');
    expect(searchCountries('turkiye').map((c) => c.code)).toContain('TR');
    expect(searchCountries('')).toHaveLength(COUNTRIES.length);
    expect(searchCountries('qqqq')).toEqual([]);
  });
});

describe('region options', () => {
  it('offers the currencies of every region', () => {
    const codes = CURRENCIES.map((c) => c.value);
    expect(codes.length).toBeGreaterThan(150);
    for (const code of ['USD', 'ZWG', 'EUR', 'GBP', 'XOF', 'XAF', 'ZAR', 'NGN', 'KES', 'EGP', 'MAD', 'DZD', 'ETB', 'AED', 'CHF', 'PLN', 'CZK', 'HUF', 'RON', 'JPY', 'CNY', 'INR', 'IDR', 'BRL', 'MXN', 'ARS', 'CAD']) expect(codes, code).toContain(code);
  });

  it('keeps launch-market time zones first and includes every region', () => {
    const zones = timezoneOptions();
    expect(zones[0]?.value).toBe('Africa/Harare');
    const values = zones.map((z) => z.value);
    expect(zones.length).toBeGreaterThan(300);
    for (const zone of ['Africa/Lagos', 'Africa/Dakar', 'Europe/Warsaw', 'Asia/Kolkata', 'Asia/Jakarta', 'America/Sao_Paulo', 'America/Mexico_City', 'Europe/Kyiv', 'UTC']) expect(values, zone).toContain(zone);
  });
});
