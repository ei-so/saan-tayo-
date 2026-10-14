import {it,expect} from 'vitest';
import {sourceLabel,retrievedLabel,moderationLabel} from './place-metadata';
import {demoRestaurants} from './domain';
it('labels supplementary and mixed providers honestly',()=>{
 const r={...demoRestaurants[0],source:'overture' as const};expect(sourceLabel(r)).toBe('Overture Maps');
 expect(sourceLabel({...r,provenance:[{source:'osm',sourceId:'node:1',url:'',attribution:'ODbL',retrievedAt:r.updatedAt,confidence:null},{source:'overture',sourceId:'a',url:'',attribution:'CDLA',retrievedAt:r.updatedAt,confidence:.9}]})).toBe('OpenStreetMap + Overture Maps');
});
it('never describes a pending fact as verified and handles missing timestamps',()=>{
 expect(moderationLabel({...demoRestaurants[0],moderationStatus:'pending_review'})).toBe('Pending review');
 expect(retrievedLabel({...demoRestaurants[0],updatedAt:'invalid'})).toBe('Date unavailable');
 expect(sourceLabel({...demoRestaurants[0],id:'local-1'})).toBe('Local submission · unverified');
});
