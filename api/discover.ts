import { normalizeOverpass,distanceKm } from '../src/domain.js'
import {createHash} from 'node:crypto'
import {fromRestaurant,deduplicatePlaces,type PlaceRecord} from '../server/places.js'
import {readNearby,getCachedDiscovery,putCachedDiscovery,consumeSearchQuota} from '../server/catalog.js'

type Response = { status(n:number):Response; json(body:unknown):void; setHeader(name:string,value:string):void }
const cache = new Map<string,{expires:number; data:unknown}>()
const requests = new Map<string,{until:number; count:number}>()
const pending = new Map<string,Promise<unknown>>()
export async function fetchOverpass(query:string) {
  const providers=['https://overpass-api.de/api/interpreter','https://overpass.private.coffee/api/interpreter']
  for(let i=0;i<providers.length;i++) {
    let upstream:globalThis.Response
    try {upstream=await fetch(providers[i],{method:'POST',body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(25000),headers:{'User-Agent':'SaanTayo/1.0 OSM restaurant discovery'}})}
    catch {if(i===0)continue;throw new Error('Restaurant search could not reach either map provider. Please try again.')}
    if(upstream.status===429||upstream.status===406)throw new Error('The map provider is busy. Wait a minute before trying again.')
    if(upstream.status>=500&&i===0)continue
    if(!upstream.ok)throw new Error('Restaurant search is temporarily unavailable.')
    return await upstream.json() as {elements?:unknown[];remark?:string}
  }
  throw new Error('Restaurant search is temporarily unavailable.')
}
export function parseLocation(query:Record<string,unknown>) {
  const values = ['lat','lng','radius'].map(k => typeof query[k] === 'string' && query[k].trim() !== '' ? Number(query[k]) : NaN)
  const [lat,lng,radius] = values
  if (!values.every(Number.isFinite) || Math.abs(lat)>90 || Math.abs(lng)>180 || radius<=0 || radius>10) throw new Error('Provide valid latitude, longitude and radius (0–10 km).')
  return {lat,lng,radius}
}
export default async function handler(req:{method?:string; query:Record<string,unknown>; headers:Record<string,string|string[]|undefined>},res:Response) {
  res.setHeader('Cache-Control','no-store')
  if(req.method!=='GET') {res.setHeader('Allow','GET'); res.status(405).json({error:'GET required'});return}
  let location:ReturnType<typeof parseLocation>
  try {location=parseLocation(req.query)} catch(e) {res.status(400).json({error:(e as Error).message});return}
  const now=Date.now(), ip=String(req.headers['x-forwarded-for']??'unknown').split(',')[0], key=JSON.stringify(location)
  for(const [k,v] of requests) if(v.until<now) requests.delete(k)
  for(const [k,v] of cache) if(v.expires<now) cache.delete(k)
  const count=requests.get(ip)??{until:now+60000,count:0};count.count++;requests.set(ip,count)
  if(count.count>12 || requests.size>10000) {res.setHeader('Retry-After','60');res.status(429).json({error:'Too many searches. Try again in a minute.'});return}
  try {
    if(!await consumeSearchQuota(createHash('sha256').update(ip).digest('hex'))){res.setHeader('Retry-After','60');res.status(429).json({error:'Too many searches. Try again in a minute.'});return}
    const hit=cache.get(key);if(hit){res.json(hit.data);return}
    const persistent=await getCachedDiscovery(location.lat,location.lng,location.radius)
    if(persistent){res.json({restaurants:persistent.map(r=>({...r,distance:distanceKm(location.lat,location.lng,r.lat,r.lng)})),source:'Cached open map records',attribution:[...new Set(persistent.flatMap(r=>r.provenance.map(p=>p.attribution)))].join('; '),fetchedAt:new Date().toISOString(),cached:true,warnings:[]});return}
    let job=pending.get(key)
    if(!job){
      job=(async()=>{
        const {lat,lng,radius}=location
        const area=`(around:${Math.round(radius*1000)},${lat},${lng})`
        const query=`[out:json][timeout:20];(nwr[amenity~"^(restaurant|fast_food|cafe|food_court|ice_cream|food_stall)$"]${area};nwr[shop~"^(bakery|food)$"]${area};nwr[shop=kiosk][cuisine]${area};nwr[street_vendor=food]${area};);out center tags 150;`
        const warnings:string[]=[];let saved:PlaceRecord[]=[]
        try{saved=(await readNearby(lat,lng,radius)).map(r=>({...r,distance:distanceKm(lat,lng,r.lat,r.lng)}))}catch{warnings.push('Supplementary cached places are temporarily unavailable.')}
        let live:PlaceRecord[]=[]
        try{
          const raw=await fetchOverpass(query)
          if(raw.remark || !Array.isArray(raw.elements)) throw new Error('The map provider returned an incomplete search. Try a smaller radius.')
          live=normalizeOverpass(raw,lat,lng).map(fromRestaurant)
        }catch(e){if(!saved.length)throw e;warnings.push('Live OpenStreetMap search is unavailable. Showing previously retrieved places; verify freshness before visiting.')}
        const restaurants=deduplicatePlaces([...live,...saved])
        const data={restaurants,source:'Open map records',attribution:[...new Set(restaurants.flatMap(r=>r.provenance.map(p=>p.attribution)))].join('; '),fetchedAt:new Date().toISOString(),warnings,cached:!live.length&&!!saved.length}
        // Provider outages must not become a fresh five-minute discovery cache.
        if(!warnings.length)try{await putCachedDiscovery(lat,lng,radius,restaurants)}catch{warnings.push('This search could not be saved to the shared cache.')}
        if(cache.size>=100) cache.delete(cache.keys().next().value!)
        if(!warnings.length)cache.set(key,{expires:Date.now()+300000,data});return data
      })().finally(()=>pending.delete(key));pending.set(key,job)
    }
    res.json(await job)
  }catch(e){res.status(503).json({error:e instanceof Error && e.name!=='TimeoutError'?e.message:'Restaurant search timed out. Please try again.'})}
}
