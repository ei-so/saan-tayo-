import { distanceKm, type Restaurant } from '../src/domain.ts';

export interface PlaceRecord extends Restaurant {
  provenance: { source: 'osm' | 'overture'; sourceId: string; url: string; retrievedAt: string; attribution: string; confidence: number | null }[];
  moderationStatus: 'unreviewed' | 'pending_review' | 'approved' | 'rejected';
  conflicts?: { field: string; values: unknown[] }[];
}
export function fromRestaurant(r: Restaurant): PlaceRecord {
  if ('provenance' in r && Array.isArray(r.provenance) && 'moderationStatus' in r) return structuredClone(r as PlaceRecord);
  return { ...r, provenance: r.source === 'demo' ? [] : [{ source: r.source, sourceId: r.id.replace(/^(osm|overture):/, ''), url: r.sourceURL || '', retrievedAt: r.updatedAt, attribution: r.source === 'osm' ? '© OpenStreetMap contributors; ODbL 1.0' : 'Overture Maps Foundation; CDLA-Permissive-2.0 / Apache-2.0 (see provider attribution)', confidence: null }], moderationStatus: 'unreviewed' };
}
type Raw = Record<string, unknown>;
function object(v: unknown): Raw { return v && typeof v === 'object' && !Array.isArray(v) ? v as Raw : {}; }
function text(v: unknown): string | undefined { return typeof v === 'string' && v.trim() ? v.trim() : undefined; }
function first(v: unknown): unknown { return Array.isArray(v) ? v[0] : undefined; }
export function normalizeOverture(raw: unknown, retrievedAt = new Date().toISOString()): PlaceRecord | null {
  const r = object(raw), names = object(r.names), taxonomy = object(r.taxonomy), bbox = object(r.bbox);
  const id = text(r.id), name = text(names.primary), lat = bbox.ymin, lng = bbox.xmin;
  if (!id || !name || !Array.isArray(taxonomy.hierarchy) || !taxonomy.hierarchy.includes('food_and_drink') || !taxonomy.hierarchy.some(v => v === 'restaurant' || v === 'casual_eatery') || typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const address = object(first(r.addresses));
  const url = `https://explore.overturemaps.org/?gers=${encodeURIComponent(id)}`;
  const sources = Array.isArray(r.sources) ? r.sources.map(s => object(s)) : [];
  return { id: `overture:${id}`, name, category: text(r.basic_category) || text(taxonomy.primary) || 'food_and_drink', cuisines: [], lat, lng, distance: 0, price: null, vegetarian: null, halal: null, image: null, source: 'overture', updatedAt: retrievedAt,
    website: text(first(r.websites)), contact: text(first(r.phones)), address: [text(address.freeform), text(address.locality), text(address.region), text(address.postcode)].filter(Boolean).join(', ') || undefined, sourceURL: url,
    moderationStatus: 'unreviewed', provenance: [{ source: 'overture', sourceId: id, url, retrievedAt, confidence: typeof r.confidence === 'number' && Number.isFinite(r.confidence) && r.confidence >= 0 && r.confidence <= 1 ? r.confidence : null,
      attribution: `Overture Maps Foundation places; CDLA-Permissive-2.0 / Apache-2.0. Providers: ${sources.map(s => [text(s.dataset), text(s.license)].filter(Boolean).join(' ')).filter(Boolean).join('; ') || 'see release attribution'}` }],
  };
}
const canonical = (s: string | undefined) => (s || '').normalize('NFKC').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function deduplicatePlaces(records: PlaceRecord[]): PlaceRecord[] {
  const result: PlaceRecord[] = [];
  const safeRecords = records.map(r => {
    const safe = structuredClone(r);
    if (safe.moderationStatus !== 'approved') for (const field of ['price', 'vegetarian', 'halal'] as const) {
      if (safe[field] !== null) {
        (safe.conflicts ||= []).push({ field, values: [safe[field]] });
        Object.assign(safe, { [field]: null });
        safe.moderationStatus = 'pending_review';
      }
    }
    return safe;
  });
  for (const record of safeRecords.sort((a, b) => a.id.localeCompare(b.id) || JSON.stringify(a).localeCompare(JSON.stringify(b)))) {
    const existing = result.find(p => p.id === record.id || p.provenance.some(a => record.provenance.some(b => a.source === b.source && a.sourceId === b.sourceId)) || (!p.provenance.some(a => record.provenance.some(b => a.source === b.source)) && p.source !== record.source && canonical(p.name) === canonical(record.name) && canonical(p.name) !== '' && canonical(p.address) !== '' && canonical(p.address) === canonical(record.address) && distanceKm(p.lat, p.lng, record.lat, record.lng) <= 0.03));
    if (!existing) { result.push(structuredClone(record)); continue; }
    const provenanceKeys = new Set(existing.provenance.map(p => JSON.stringify(p)));
    record.provenance.forEach(p => { if (!provenanceKeys.has(JSON.stringify(p))) existing.provenance.push(structuredClone(p)); });
    if (record.conflicts?.length) existing.conflicts = [...new Map([...(existing.conflicts || []), ...record.conflicts].map(c => [JSON.stringify(c), structuredClone(c)])).values()];
    for (const field of ['name', 'category', 'address', 'website', 'contact', 'openingHours', 'price', 'vegetarian', 'halal', 'cuisines'] as const) {
      const before = existing[field], after = record[field];
      const missing = (v: unknown) => v == null || v === '' || Array.isArray(v) && !v.length;
      if (missing(after)) continue;
      if (missing(before)) {
        // Price and dietary verification must come from human moderation, not a merge.
        if (!['price', 'vegetarian', 'halal'].includes(field)) Object.assign(existing, { [field]: structuredClone(after) });
      } else if (JSON.stringify(before) !== JSON.stringify(after)) {
        (existing.conflicts ||= []).push({ field, values: [before, after] });
        existing.moderationStatus = 'pending_review';
        if (['price', 'vegetarian', 'halal'].includes(field)) Object.assign(existing, { [field]: null });
      }
    }
    if (distanceKm(existing.lat, existing.lng, record.lat, record.lng) > 0.03) {
      (existing.conflicts ||= []).push({ field: 'coordinates', values: [[existing.lat, existing.lng], [record.lat, record.lng]] });
      existing.moderationStatus = 'pending_review';
    }
    if (record.moderationStatus !== 'unreviewed' && record.moderationStatus !== existing.moderationStatus) existing.moderationStatus = 'pending_review';
  }
  return result;
}
