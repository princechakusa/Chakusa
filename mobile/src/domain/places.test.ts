import { describe, expect, it } from 'vitest';
import { directionsUrl, distanceLabel, placeFromNominatim } from './places';

describe('placeFromNominatim', () => {
  it('builds a short "area, city" label and an address line', () => {
    const place = placeFromNominatim({
      lat: '-17.8000', lon: '31.0400',
      address: { house_number: '12', road: 'King George Road', suburb: 'Avondale', city: 'Harare', state: 'Harare Province', country: 'Zimbabwe' },
    });
    expect(place).toEqual({ latitude: -17.8, longitude: 31.04, label: 'Avondale, Harare', addressLine: '12 King George Road', city: 'Harare', region: 'Harare Province' });
  });

  it('falls back through town/village and region when there is no city', () => {
    expect(placeFromNominatim({ lat: '1', lon: '2', address: { village: 'Nyanga', state: 'Manicaland' } }).label).toBe('Nyanga');
    expect(placeFromNominatim({ lat: '1', lon: '2', address: { state: 'Manicaland' } }).label).toBe('Manicaland');
    expect(placeFromNominatim({ lat: '1', lon: '2', display_name: 'Somewhere, Far, Away' }).label).toBe('Somewhere, Far');
    expect(placeFromNominatim({ lat: '1.23456', lon: '2.5' }).label).toBe('1.2346, 2.5000');
  });

  it('does not repeat the city as the area', () => {
    expect(placeFromNominatim({ lat: '0', lon: '0', address: { suburb: 'Harare', city: 'Harare' } }).label).toBe('Harare');
  });
});

describe('distanceLabel', () => {
  it('formats metres, tenths and whole kilometres', () => {
    expect(distanceLabel(0.34)).toBe('350 m away');
    expect(distanceLabel(0.01)).toBe('50 m away');
    expect(distanceLabel(1.2)).toBe('1.2 km away');
    expect(distanceLabel(3)).toBe('3 km away');
    expect(distanceLabel(14.4)).toBe('14 km away');
  });
  it('says nothing when there is no distance', () => {
    expect(distanceLabel(null)).toBeNull();
    expect(distanceLabel(undefined)).toBeNull();
    expect(distanceLabel(Number.NaN)).toBeNull();
  });
});

it('links directions to OpenStreetMap', () => {
  expect(directionsUrl(-17.8, 31.04)).toBe('https://www.openstreetmap.org/directions?to=-17.80000%2C31.04000#map=16/-17.80000/31.04000');
});
