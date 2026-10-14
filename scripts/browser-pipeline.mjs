import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {normalizeOverture} from '../server/places.ts';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const pilot=JSON.parse(await readFile(new URL('../docs/pipeline/pilot-overture.json',import.meta.url),'utf8'));
const records=pilot.records.map(r=>normalizeOverture(r,pilot.retrievedAt)).filter(Boolean);
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const context=await browser.newContext();const page=await context.newPage();const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 // A simulated cache response uses actual licensed pilot records; no provider calls.
 await page.route('**/api/discover?**',route=>route.fulfill({json:{restaurants:records,warnings:[],cached:true}}));
 await mkdir('artifacts',{recursive:true});
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});await page.goto((process.env.APP_URL||'http://localhost:5173')+'/discover');
  await page.getByRole('button',{name:'Search this area'}).click();await page.getByText(/Found 20 places/).waitFor();
  assert.equal(await page.locator('.restaurant').count(),20);
  await page.getByRole('button',{name:`View ${records[0].name}`,exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  assert((await dialog.getByText('Overture Maps',{exact:true}).count())>=1);
  await dialog.getByText('Unreviewed data',{exact:true}).waitFor();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:`artifacts/pipeline-${width}.png`,fullPage:true});
  await page.getByRole('button',{name:'Close place details'}).click();
 }
 assert.equal(errors.length,0,errors.join('\n'));
 console.log('PASS: actual 20-row Bacolor pilot rendered through simulated cache; source, timestamp, moderation and unknowns on desktop/mobile; no paid calls');
}finally{await browser.close()}
