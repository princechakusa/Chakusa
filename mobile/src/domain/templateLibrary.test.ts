import { describe, expect, it } from 'vitest';
import type { MessageType } from '../apiTypes';
import { starterTemplatesFor, TEMPLATE_LIBRARY } from './templateLibrary';

const TYPES: MessageType[] = ['missed_call', 'booking_confirmation', 'review_request', 'private_feedback', 'comeback_reminder', 'custom', 'public_profile_inquiry', 'lead_follow_up'];
const KNOWN = new Set(['customer_name', 'business_name', 'service_name', 'booking_time', 'review_link', 'phone_number']);

describe('ready-made template library', () => {
  it('offers at least one starter for every template type, with unique ids', () => {
    for (const type of TYPES) expect(starterTemplatesFor(type).length).toBeGreaterThan(0);
    expect(new Set(TEMPLATE_LIBRARY.map((t) => t.id)).size).toBe(TEMPLATE_LIBRARY.length);
  });

  it('only uses variables the server renders, and fits a template body', () => {
    for (const starter of TEMPLATE_LIBRARY) {
      const used = [...starter.body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
      expect(used.filter((v) => !KNOWN.has(v!))).toEqual([]);
      expect(starter.body.length).toBeLessThanOrEqual(1000);
      expect(starter.name.trim().length).toBeGreaterThan(0);
    }
  });
});
