import Dexie, { type Table } from 'dexie';
import type { Restaurant, Room } from './domain';

const db = new Dexie('saantayo');
db.version(1).stores({ saved: '&key', history: '&id' });
const saved = db.table('saved') as Table<{ key: string; value: Room | Restaurant[] }, string>;
const history = db.table('history') as Table<{ id: string; room: Room; savedAt: number }, string>;

async function access<T>(operation: () => Promise<T>): Promise<T> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is unavailable');
    return await operation();
  } catch (cause) {
    throw new Error('Local storage is unavailable. Your current session can continue, but changes may not survive closing the app.', { cause });
  }
}
export async function saveRoom(room: Room): Promise<void> {
  await access(() => saved.put({ key: 'room', value: structuredClone(room) }));
}
export async function loadRoom(): Promise<Room | null> {
  return access(async () => (await saved.get('room'))?.value as Room ?? null);
}
export async function saveRestaurants(restaurants: Restaurant[]): Promise<void> {
  await access(() => saved.put({ key: 'restaurants', value: structuredClone(restaurants) }));
}
export async function loadRestaurants(): Promise<Restaurant[]> {
  return access(async () => (await saved.get('restaurants'))?.value as Restaurant[] ?? []);
}
export async function saveHistory(room: Room): Promise<void> {
  await access(() => history.put({ id: room.id, room: structuredClone(room), savedAt: Date.now() }));
}
export async function loadHistory(): Promise<Room[]> {
  return access(async () => (await history.toArray()).sort((a, b) => b.savedAt - a.savedAt).map(entry => entry.room));
}
export async function clearSaved(): Promise<void> {
  await access(() => db.transaction('rw', saved, history, async () => { await saved.clear(); await history.clear(); }));
}
