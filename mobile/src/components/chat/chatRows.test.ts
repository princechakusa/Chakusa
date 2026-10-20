import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Animated: {}, Easing: {}, FlatList: () => null, Pressable: () => null, StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 }, Text: () => null, TextInput: () => null, View: () => null, ActivityIndicator: () => null, Keyboard: { addListener: () => ({ remove() {} }) }, LayoutAnimation: {}, Platform: { OS: 'android' } }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const { chatRows } = await import('./ChatKit');

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
