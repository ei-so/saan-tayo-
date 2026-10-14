import { expect, it } from 'vitest';
import { fromRestaurant, normalizeOverture, deduplicatePlaces } from './places';
import { demoRestaurants } from '../src/domain';
import pilot from '../docs/pipeline/pilot-overture.json';
const raw = { id: 'gers-1', names: { primary: 'Cafe — Bacolor' }, bbox: { xmin: 120.6514, ymin: 14.9966 }, taxonomy: { hierarchy: ['food_and_drink', 'casual_eatery', 'cafe'], primary: 'cafe' }, basic_category: 'cafe', confidence: 0.9, addresses: [{ freeform: '10 Main St', locality: 'Bacolor' }], websites: ['https://example.org'] };
it('normalizes current taxonomy and retains unknown facts and attribution', () => {
  const p = normalizeOverture(raw, '2026-10-15T00:00:00Z')!;
  expect(p).toMatchObject({ id: 'overture:gers-1', source: 'overture', cuisines: [], price: null, vegetarian: null, category: 'cafe', moderationStatus: 'unreviewed' });
  expect(p.provenance[0]).toMatchObject({ confidence: 0.9, sourceId: 'gers-1' });
  expect(normalizeOverture({ ...raw, taxonomy: { hierarchy: ['shopping'] } })).toBeNull();
  expect(normalizeOverture({ ...raw, bbox: { xmin: 999, ymin: 15 } })).toBeNull();
  expect(normalizeOverture({ ...raw, taxonomy: { hierarchy: ['food_and_drink', 'bar'] } })).toBeNull();
});
it('merges exact same name/address nearby across sources and retains both origins', () => {
  const a = normalizeOverture(raw)!;
  const b = fromRestaurant({ ...demoRestaurants[0], source: 'osm', id: 'osm:node:1', name: a.name, address: a.address, lat: a.lat, lng: a.lng, category: 'cafe', price: null, vegetarian: null, halal: null });
  const merged = deduplicatePlaces([a, b]);
  expect(merged).toHaveLength(1);
  expect(merged[0].provenance).toHaveLength(2);
  expect(deduplicatePlaces([b, a])).toEqual(merged);
  expect(deduplicatePlaces([a, b, { ...a, id: 'overture:other', provenance: [{ ...a.provenance[0], sourceId: 'other' }] }])).toHaveLength(2);
});
it('retains different branches and conflicting facts for human review', () => {
  const a = normalizeOverture(raw)!;
  const other = { ...a, id: 'overture:other', provenance: [{ ...a.provenance[0], sourceId: 'other' }] };
  expect(deduplicatePlaces([a, { ...other, address: '20 Main St' }])).toHaveLength(2);
  expect(deduplicatePlaces([a, other])).toHaveLength(2);
  const conflicts = deduplicatePlaces([a, { ...a, id: a.id, price: 100 }]);
  expect(conflicts).toHaveLength(1);
  expect(conflicts[0].price).toBeNull();
  const both = deduplicatePlaces([a, { ...a, id: a.id, category: 'bakery' }]);
  expect(both[0].moderationStatus).toBe('pending_review');
  expect(both[0].conflicts?.[0].field).toBe('category');
});
it('accepts all bounded real pilot records without inventing hard facts', () => {
  const records = pilot.records.map(r => normalizeOverture(r, pilot.retrievedAt));
  expect(records).toHaveLength(20);
  expect(records.every(p => p && p.price === null && p.halal === null && p.vegetarian === null && p.provenance[0].attribution.includes('meta CDLA-Permissive-2.0'))).toBe(true);
});
