export interface Restaurant {
  id: string; name: string; category: string; cuisines: string[]; lat: number; lng: number;
  distance: number; price: number | null; vegetarian: boolean | null; halal: boolean | null;
  image: string | null; source: 'demo' | 'osm' | 'overture'; updatedAt: string;
  website?: string; address?: string; openingHours?: string; contact?: string; sourceURL?: string;
  provenance?: {source:'osm'|'overture';sourceId:string;url:string;retrievedAt:string;attribution:string;confidence:number|null}[];
  moderationStatus?: 'unreviewed'|'pending_review'|'approved'|'rejected';
}
export interface Preferences {
  budget: number; distance: number; cuisines: string[]; vegetarian: boolean; halal: boolean; allowUnknown: boolean;
}
export interface Participant { id: string; name: string; prefs: Preferences; votes: Record<string, number> }
export interface Room {
  id: string; code: string; name: string; hostId: string; participants: Participant[]; candidates: Restaurant[];
  status: 'waiting' | 'voting' | 'finished'; winnerId: string | null; mode: 'demo' | 'online';
}
export const defaultPreferences: Preferences = { budget: 300, distance: 5, cuisines: [], vegetarian: false, halal: false, allowUnknown: false };
export const demoRestaurants: Restaurant[] = [
  ['demo-kubo', 'Mang Kubo Kitchen', 'Filipino', 'filipino', 180, 0.6, true, false],
  ['demo-noodles', 'Noodle Corner', 'Noodles', 'chinese', 220, 1.1, true, false],
  ['demo-green', 'Green Bowl', 'Plant based', 'vegetarian', 95, 0.4, true, true],
  ['demo-grill', 'Barkada Grill', 'Grill', 'filipino', 250, 1.7, false, false],
  ['demo-pizza', 'Slice & Share', 'Pizza', 'italian', 280, 2.2, true, false],
].map(([id, name, category, cuisine, price, distance, vegetarian, halal], i) => ({
  id: String(id), name: String(name), category: String(category), cuisines: [String(cuisine)],
  lat: 14.9966 + i * 0.003, lng: 120.6514 + i * 0.002, price: Number(price), distance: Number(distance),
  vegetarian: Boolean(vegetarian), halal: Boolean(halal), image: null, source: 'demo', updatedAt: '2026-10-14T00:00:00Z',
}));
export function makeDemoRoom(): Room {
  return {
    id: crypto.randomUUID(), code: 'DEMO', name: 'Barkada lunch', hostId: 'demo-kurt', mode: 'demo', status: 'waiting', winnerId: null,
    candidates: structuredClone(demoRestaurants),
    participants: ['Kurt', 'Mika', 'Josh', 'Andrea', 'Paul'].map(name => ({ id: `demo-${name.toLowerCase()}`, name, prefs: structuredClone(defaultPreferences), votes: {} })),
  };
}
export function eligible(restaurants: Restaurant[], participants: Participant[]): Restaurant[] {
  if (!participants.length) return [];
  return restaurants.filter(r => participants.every(({ prefs: p }) =>
    Number.isFinite(p.budget) && p.budget > 0 && Number.isFinite(p.distance) && p.distance > 0 &&
    Number.isFinite(r.distance) && r.distance >= 0 && r.distance <= p.distance &&
    (r.price === null ? p.allowUnknown : Number.isFinite(r.price) && r.price >= 0 && r.price <= p.budget) &&
    (!p.vegetarian || r.vegetarian === true || (r.vegetarian === null && p.allowUnknown)) &&
    (!p.halal || r.halal === true || (r.halal === null && p.allowUnknown))
  ));
}
export function rank(room: Room) {
  const people = room.participants;
  return eligible(room.candidates, people).map(restaurant => {
    const votes = people.map(p => p.votes[restaurant.id]);
    const validVote = (v: number) => v === 0 || v === 1 || v === 2;
    const complete = votes.every(validVote);
    const approval = votes.filter(v => validVote(v) && v > 0).length;
    const unknown = restaurant.price === null || people.some(p =>
      (p.prefs.vegetarian && restaurant.vegetarian === null) || (p.prefs.halal && restaurant.halal === null));
    const components = [{ weight: 55, value: votes.reduce((sum, v) => sum + (validVote(v) ? v : 0), 0) / (people.length * 2) }];
    const cravings = people.filter(p => p.prefs.cuisines.length);
    if (cravings.length && restaurant.cuisines.length) components.push({ weight: 25, value: cravings.filter(p => p.prefs.cuisines.some(c => restaurant.cuisines.some(rc => rc.toLowerCase() === c.toLowerCase()))).length / cravings.length });
    if (restaurant.price !== null) components.push({ weight: 10, value: people.reduce((sum, p) => sum + Math.max(0, 1 - restaurant.price! / p.prefs.budget), 0) / people.length });
    components.push({ weight: 10, value: people.reduce((sum, p) => sum + Math.max(0, 1 - restaurant.distance / p.prefs.distance), 0) / people.length });
    const score = Math.round(1000 * components.reduce((sum, c) => sum + c.weight * c.value, 0) / components.reduce((sum, c) => sum + c.weight, 0)) / 10;
    const kind = !complete ? 'pending' : unknown ? 'verification' : approval === people.length ? 'perfect' : 'compromise';
    const explanation = `${approval} of ${people.length} approved. ${!complete ? 'Voting is incomplete. ' : ''}${unknown ? 'Price or required dietary information needs verification. ' : 'All budget, distance and required dietary limits are met. '}Score uses approval (55), cuisine (25), affordability (10), distance (10); unavailable components are excluded and remaining weights are rebalanced.`;
    return { restaurant, score, approval, kind, explanation };
  }).sort((a, b) => b.score - a.score || a.restaurant.id.localeCompare(b.restaurant.id));
}
export function simulate(room: Room, scenario: 'perfect' | 'compromise'): Room {
  const next = structuredClone(room);
  const candidates = eligible(next.candidates, next.participants);
  next.participants.forEach((p, i) => { next.candidates.forEach((r, j) => {
    if (p.votes[r.id] === 0 || p.votes[r.id] === 1 || p.votes[r.id] === 2) return;
    p.votes[r.id] = scenario === 'perfect' && r.id === candidates[0]?.id ? 2 : (i === j % next.participants.length ? 0 : 1);
  }); });
  next.status = 'finished';
  next.winnerId = rank(next)[0]?.restaurant.id ?? null;
  return next;
}
export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * rad / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin((lng2 - lng1) * rad / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}
export function normalizeOverpass(data: unknown, lat: number, lng: number): Restaurant[] {
  if (!data || typeof data !== 'object' || !('elements' in data) || !Array.isArray(data.elements)) return [];
  const found = new Map<string, Restaurant>();
  for (const raw of data.elements) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as { type?: string; id?: number; lat?: number; lon?: number; center?: { lat?: number; lon?: number }; tags?: Record<string, string> };
    const y = e.lat ?? e.center?.lat; const x = e.lon ?? e.center?.lon;
    if (!['node', 'way', 'relation'].includes(e.type ?? '') || !Number.isSafeInteger(e.id) || !e.tags || typeof e.tags.name !== 'string' || !e.tags.name.trim() || typeof y !== 'number' || typeof x !== 'number' || !Number.isFinite(y) || !Number.isFinite(x) || Math.abs(y) > 90 || Math.abs(x) > 180) continue;
    const id = `osm:${e.type}:${e.id}`;
    if (found.has(id)) continue;
    const diet = (v?: string) => v === 'yes' || v === 'only' ? true : v === 'no' ? false : null;
    // shortcut: OSM image tags lack licensing metadata; resolve licensed Commons images server-side before displaying them.
    found.set(id, { id, name: e.tags.name.trim(), category: e.tags.amenity || e.tags.shop || 'food', cuisines: typeof e.tags.cuisine === 'string' ? e.tags.cuisine.split(';').map(c => c.trim()).filter(Boolean) : [], lat: y, lng: x, distance: distanceKm(lat, lng, y, x), price: null, vegetarian: diet(e.tags['diet:vegetarian']), halal: diet(e.tags['diet:halal']), image: null, source: 'osm', updatedAt: new Date().toISOString(), website: e.tags.website || e.tags['contact:website'] || undefined, address: [e.tags['addr:housenumber'], e.tags['addr:street'], e.tags['addr:city']].filter(Boolean).join(' ') || undefined, openingHours: e.tags.opening_hours || undefined, contact: e.tags.phone || e.tags['contact:phone'] || undefined, sourceURL: `https://www.openstreetmap.org/${e.type}/${e.id}` });
  }
  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
}
