import { expect, it } from 'vitest';
import { clearSaved, loadHistory, loadRestaurants, loadRoom, saveHistory, saveRestaurants, saveRoom } from './storage';
import { makeDemoRoom } from './domain';

it('reports unavailable storage as a recoverable error on every operation', async () => {
  for (const operation of [() => loadRoom(), () => loadRestaurants(), () => loadHistory(), () => saveRoom(makeDemoRoom()), () => saveRestaurants([]), () => saveHistory(makeDemoRoom()), () => clearSaved()]) {
    await expect(operation()).rejects.toThrow('Local storage is unavailable');
  }
});
