import {readFile} from 'node:fs/promises';
import {normalizeOverture,deduplicatePlaces} from '../server/places.ts';
import {ingestPlaces} from '../server/catalog.ts';
const args=process.argv.slice(2);
if(args.some(a=>a!=='--apply'))throw new Error('Only --apply is supported; the reviewed Bacolor pilot is the sole input.');
const pilot=JSON.parse(await readFile(new URL('../docs/pipeline/pilot-overture.json',import.meta.url),'utf8'));
if(!Array.isArray(pilot.records)||pilot.records.length>20)throw new Error('Only the small reviewed pilot (maximum 20 records) is permitted.');
const records=deduplicatePlaces(pilot.records.map(r=>normalizeOverture(r,pilot.retrievedAt)).filter(Boolean));
if(records.length!==pilot.records.length)throw new Error('Invalid or duplicate pilot rows require review before import.');
if(records.some(r=>r.lat<14.985||r.lat>15.01||r.lng<120.64||r.lng>120.665))throw new Error('Pilot record outside approved Bacolor bounding box.');
if(args.includes('--apply')){await ingestPlaces(records);console.log(`Imported ${records.length} source records; no crawling, AI calls or scheduling.`)}
else console.log(JSON.stringify({dryRun:true,records:records.length,providers:[...new Set(records.flatMap(r=>r.provenance.map(p=>p.source)))],names:records.slice(0,5).map(r=>r.name),pendingFields:['price','dietary information','menu'],paidCalls:0},null,2));
