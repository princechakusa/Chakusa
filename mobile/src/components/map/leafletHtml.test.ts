import { describe, expect, it } from 'vitest';
import { leafletHtml, parseMapMessage, scriptSafeJson } from './leafletHtml';

describe('leafletHtml', () => {
  const page = leafletHtml({ id: 'm1', center: { latitude: -17.8, longitude: 31.04 }, markers: [{ latitude: -17.8, longitude: 31.04, kind: 'business', label: 'Ada Hair Studio' }], pickable: true });

  it('uses free OpenStreetMap tiles with the required attribution and SRI-pinned Leaflet', () => {
    expect(page).toContain('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    expect(page).toContain('OpenStreetMap</a> contributors');
    expect(page).toMatch(/leaflet@1\.9\.4\/dist\/leaflet\.js" integrity="sha256-/);
  });

  it('cannot be broken out of by a hostile label', () => {
    const hostile = leafletHtml({ id: 'm2', center: { latitude: 0, longitude: 0 }, markers: [{ latitude: 0, longitude: 0, kind: 'business', label: '</script><script>alert(1)</script>' }] });
    expect(hostile).not.toContain('</script><script>alert(1)');
    expect(scriptSafeJson({ a: '<b>&' + String.fromCharCode(0x2028) })).toBe('{"a":"\\u003cb\\u003e\\u0026\\u2028"}');
  });

  it('drops markers with non-finite coordinates', () => {
    const html = leafletHtml({ id: 'm3', center: { latitude: 0, longitude: 0 }, markers: [{ latitude: Number.NaN, longitude: 0, kind: 'business', label: 'Broken' }] });
    expect(html).not.toContain('Broken');
  });
});

describe('parseMapMessage', () => {
  const pick = JSON.stringify({ source: 'chakusa-map', id: 'm1', type: 'pick', latitude: 1, longitude: 2 });
  it('accepts a pick for this map only', () => {
    expect(parseMapMessage(pick, 'm1')).toMatchObject({ type: 'pick', latitude: 1, longitude: 2 });
    expect(parseMapMessage(pick, 'other')).toBeNull();
  });
  it('ignores foreign, malformed and incomplete messages', () => {
    expect(parseMapMessage('not json', 'm1')).toBeNull();
    expect(parseMapMessage({ source: 'chakusa-map' }, 'm1')).toBeNull();
    expect(parseMapMessage(JSON.stringify({ source: 'someone-else', id: 'm1', type: 'pick', latitude: 1, longitude: 2 }), 'm1')).toBeNull();
    expect(parseMapMessage(JSON.stringify({ source: 'chakusa-map', id: 'm1', type: 'pick', latitude: 'x', longitude: 2 }), 'm1')).toBeNull();
  });
});
