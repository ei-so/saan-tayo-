import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext();
const page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const url=process.env.APP_URL||'http://localhost:5173';
await mkdir('artifacts',{recursive:true});
try{
 for(const width of [1440,768,390]){
  await page.setViewportSize({width,height:900});await page.goto(url);await page.locator('h1').waitFor();await page.evaluate(()=>document.fonts.ready);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Overflow ${width}`);
  await page.screenshot({path:`artifacts/home-${width}.png`,fullPage:true});
 }
 await page.goto(url+'/discover');await page.getByRole('heading',{name:/craving/i}).waitFor();
 assert(await page.locator('select').first().inputValue()==='3','Bacolor 3km default');
 await page.screenshot({path:'artifacts/discover-mobile.png',fullPage:true});
 if(process.env.CHECK_LIVE==='true'){
  await page.getByRole('button',{name:'Search this area'}).click();
  await page.getByText(/Found \d+ places from OpenStreetMap/).waitFor({timeout:60000});
  assert(await page.locator('.restaurant').count()>0);
  await page.screenshot({path:'artifacts/discover-live-mobile.png',fullPage:true});
  console.log('PASS: actual Bacolor OSM discovery renders real venues');
  await page.goto(url);await page.getByRole('button',{name:/demo/i}).click();
  await page.goto(url+'/discover');
 }
 await page.goto(url+'/create');await page.screenshot({path:'artifacts/create-mobile.png',fullPage:true});
 await page.getByLabel('Your name',{exact:true}).fill('Kurt');
 await page.getByRole('button',{name:'Create our table'}).click();await page.waitForURL('**/room');
 await page.getByRole('link',{name:'My preferences'}).click();
 await page.getByRole('button',{name:/make some picks/i}).click();await page.waitForURL('**/vote');
 await page.getByRole('button',{name:'Pass',exact:true}).click();
 await page.getByRole('button',{name:'Undo last pick'}).click();
 for(let i=0;i<5;i++){await page.getByRole('button',{name:'Let’s eat here',exact:true}).click();}
 await page.getByRole('heading',{name:'Your picks are in.'}).waitFor();
 await page.getByRole('link',{name:'Back to the table'}).click();
 await page.getByRole('button',{name:/Reveal the group/i}).click();await page.waitForURL('**/results');
 await page.getByText('Everyone said yes',{exact:true}).waitFor();
 await page.screenshot({path:'artifacts/results-mobile.png',fullPage:true});
 await page.reload();await page.getByRole('heading',{name:'Tara, kain.'}).waitFor();
 await page.goto(url+'/history');await page.getByRole('button',{name:'Revisit'}).waitFor();
 if(process.env.CHECK_OFFLINE==='true'){
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await context.setOffline(true);await page.reload();
  await page.getByRole('button',{name:'Revisit'}).waitFor();
  await page.goto(url);await page.getByRole('button',{name:/demo/i}).click();
  await page.waitForURL('**/room');
  await page.getByRole('link',{name:'My preferences'}).click();
  await page.getByRole('button',{name:/make some picks/i}).click();await page.waitForURL('**/vote');
  await page.getByRole('link',{name:'Our table',exact:true}).click();
  await page.getByRole('button',{name:/Fill remaining demo votes: agreement/i}).click();
  await page.waitForURL('**/results');await page.getByText('Everyone said yes',{exact:true}).waitFor();
  console.log('PASS: production service worker, offline reload, persisted history, offline five-person demo');
 }
 assert.equal(errors.length,0,errors.join('\n'));
 console.log('PASS: three viewport layouts, Bacolor default, create/preferences/voting/undo/results/reload/history and no runtime errors');
}finally{await browser.close()}
