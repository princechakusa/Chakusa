import { describe, expect, it } from 'vitest';
import { CURRENCIES, timezoneOptions } from './regionOptions';

describe('region dropdown options', () => {
  it('offers only ISO 4217 codes the API accepts, once each, with ZWG and USD', () => {
    const codes = CURRENCIES.map((c) => c.value);
    expect(codes.every((c) => /^[A-Z]{3}$/.test(c))).toBe(true);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toEqual(expect.arrayContaining(['USD', 'ZWG', 'ZAR']));
  });

  it('offers only real IANA time zones, once each, including Harare', () => {
    const zones = timezoneOptions().map((z) => z.value);
    const invalid = zones.filter((z) => { try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return false; } catch { return true; } });
    expect(invalid).toEqual([]);
    expect(new Set(zones).size).toBe(zones.length);
    expect(zones).toContain('Africa/Harare');
  });
});
