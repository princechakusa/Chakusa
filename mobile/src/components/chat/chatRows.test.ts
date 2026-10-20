import { describe, expect, it } from 'vitest';
import { chatRows } from './chatRows';


describe('chatRows (inverted WhatsApp list)', () => {
  it('puts the newest message first and a day chip above each day', () => {
    const rows = chatRows([
      { id: 'a', text: 'hi', mine: false, at: '2026-10-18T09:00:00Z' },
      { id: 'b', text: 'hello', mine: true, at: '2026-10-18T09:01:00Z' },
      { id: 'c', text: 'tomorrow?', mine: true, at: '2026-10-19T10:00:00Z' },
    ]);
    expect(rows.map((r) => r.id)).toEqual(['c', expect.stringMatching(/^day-/), 'b', 'a', expect.stringMatching(/^day-/)]);
  });

  it('marks the first bubble of each sender run (tail + group gap)', () => {
    const rows = chatRows([
      { id: 'a', text: '1', mine: true, at: '2026-10-19T10:00:00Z' },
      { id: 'b', text: '2', mine: true, at: '2026-10-19T10:01:00Z' },
      { id: 'c', text: '3', mine: false, at: '2026-10-19T10:02:00Z' },
    ]).filter((r) => r.kind === 'msg') as Array<{ id: string; first: boolean }>;
    expect(Object.fromEntries(rows.map((r) => [r.id, r.first]))).toEqual({ a: true, b: false, c: true });
  });
});
