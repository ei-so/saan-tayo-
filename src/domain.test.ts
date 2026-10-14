import { describe, expect, it } from 'vitest';
import { defaultPreferences, demoRestaurants, distanceKm, eligible, makeDemoRoom, normalizeOverpass, rank, simulate } from './domain';

describe('matching', () => {
  it('never admits invalid prices or distances even when unknown values are allowed', () => {
    const room = makeDemoRoom();
    room.participants.forEach(p => { p.prefs.allowUnknown = true; });
    for (const price of [-1, NaN, Infinity, undefined]) {
      expect(eligible([{ ...demoRestaurants[0], price } as typeof demoRestaurants[number]], room.participants)).toEqual([]);
    }
    for (const distance of [-1, NaN, Infinity, undefined]) {
      expect(eligible([{ ...demoRestaurants[0], distance } as typeof demoRestaurants[number]], room.participants)).toEqual([]);
    }
  });
  it('allowing unknown details never overrides a confirmed dietary incompatibility', () => {
    const room = makeDemoRoom();
    room.participants.forEach(p => { p.prefs = { ...defaultPreferences, allowUnknown: true, halal: true, vegetarian: true }; });
    expect(eligible([{ ...demoRestaurants[0], price: null, halal: false, vegetarian: null }], room.participants)).toEqual([]);
    expect(eligible([{ ...demoRestaurants[0], price: null, halal: null, vegetarian: false }], room.participants)).toEqual([]);
    expect(eligible([{ ...demoRestaurants[0], price: null, halal: null, vegetarian: null }], room.participants)).toHaveLength(1);
  });
  it('invalid votes remain pending and cannot turn into unanimous approval', () => {
    const room = makeDemoRoom();
    room.participants.forEach(p => { p.votes[demoRestaurants[0].id] = 2; });
    for (const vote of [-1, 3, NaN, Infinity]) {
      room.participants[0].votes[demoRestaurants[0].id] = vote;
      const match = rank(room).find(r => r.restaurant.id === demoRestaurants[0].id)!;
      expect(match.kind).toBe('pending');
      expect(match.approval).toBe(room.participants.length - 1);
      expect(Number.isFinite(match.score)).toBe(true);
    }
  });
  it('enforces every participant budget, distance and required diet', () => {
    const room = makeDemoRoom();
    room.participants[0].prefs = { ...defaultPreferences, budget: 100, distance: 1, vegetarian: true };
    expect(eligible(room.candidates, room.participants).every(r => r.price !== null && r.price <= 100 && r.distance <= 1 && r.vegetarian === true)).toBe(true);
  });
  it('excludes unknown prices unless everyone explicitly allows them', () => {
    const room = makeDemoRoom();
    room.candidates = [{ ...demoRestaurants[0], price: null }];
    expect(rank(room)).toEqual([]);
    room.participants.forEach(p => { p.prefs.allowUnknown = true; p.votes[room.candidates[0].id] = 2; });
    expect(rank(room)[0].kind).toBe('verification');
  });
  it('missing votes never produce a perfect match', () => {
    const room = makeDemoRoom();
    room.participants[0].votes[room.candidates[0].id] = 2;
    expect(rank(room).every(r => r.kind !== 'perfect')).toBe(true);
  });
  it('derives deterministic simulation results from actual votes', () => {
    const perfect = simulate(makeDemoRoom(), 'perfect');
    expect(rank(perfect)[0].kind).toBe('perfect');
    expect(rank(simulate(makeDemoRoom(), 'compromise')).every(r => r.kind !== 'perfect')).toBe(true);
    expect(simulate(makeDemoRoom(), 'perfect').participants.map(p => p.votes)).toEqual(perfect.participants.map(p => p.votes));
  });
  it('has stable ties and does not mutate the room', () => {
    const room = makeDemoRoom();
    room.candidates = [{ ...demoRestaurants[0], id: 'z' }, { ...demoRestaurants[0], id: 'a' }];
    expect(rank(room).map(r => r.restaurant.id)).toEqual(['a', 'z']);
    expect(room.candidates[0].id).toBe('z');
  });
  it('simulation fills only missing votes and preserves participant decisions', () => {
    const room = makeDemoRoom();
    room.participants[0].votes[room.candidates[0].id] = 0;
    expect(simulate(room, 'perfect').participants[0].votes[room.candidates[0].id]).toBe(0);
  });
});

it('preserves source details without guessing missing values', () => {
  const [place] = normalizeOverpass({ elements: [{ type: 'node', id: 7, lat: 14.99, lon: 120.65, tags: { name: 'Shop', shop: 'bakery', website: 'https://example.com', 'addr:street': 'Main St', opening_hours: 'Mo-Fr 09:00-17:00', 'contact:phone': '+63 123' } }] }, 14.99, 120.65);
  expect(place).toMatchObject({ category: 'bakery', website: 'https://example.com', address: 'Main St', openingHours: 'Mo-Fr 09:00-17:00', contact: '+63 123', sourceURL: 'https://www.openstreetmap.org/node/7' });
});

describe('OSM normalization', () => {
  it('handles node, way and relation and drops unnamed, invalid and duplicate entries', () => {
    const data = { elements: [
      { type: 'node', id: 1, lat: 14.5, lon: 121, tags: { name: 'Real place', cuisine: 'filipino;chicken', image: 'https://example.com/unlicensed.jpg' } },
      { type: 'node', id: 1, lat: 14.5, lon: 121, tags: { name: 'Duplicate' } },
      { type: 'way', id: 2, center: { lat: 14.5, lon: 121.01 }, tags: { name: 'Cafe', amenity: 'cafe', 'diet:vegetarian': 'yes' } },
      { type: 'relation', id: 3, center: { lat: 14.51, lon: 121 }, tags: { name: 'Third' } },
      { type: 'node', id: 4, lat: 100, lon: 121, tags: { name: 'Bad coords' } },
      { type: 'node', id: 5, lat: 14.5, lon: 121, tags: {} },
    ] };
    const places = normalizeOverpass(data, 14.5, 121);
    expect(places.map(p => p.id)).toEqual(['osm:node:1', 'osm:relation:3', 'osm:way:2']);
    expect(places[0]).toMatchObject({ price: null, vegetarian: null, halal: null, image: null, source: 'osm', cuisines: ['filipino', 'chicken'] });
    expect(normalizeOverpass(null, 14, 121)).toEqual([]);
    expect(distanceKm(14, 121, 14, 121)).toBe(0);
  });
});
