import {describe,it,expect,vi,beforeEach} from 'vitest';
const catalog=vi.hoisted(()=>({readNearby:vi.fn(),getCachedDiscovery:vi.fn(),putCachedDiscovery:vi.fn(),consumeSearchQuota:vi.fn()}));
vi.mock('../server/catalog.js',()=>catalog);
import {demoRestaurants} from '../src/domain';
import handler from './discover';
const req=(lat:string)=>({method:'GET',query:{lat,lng:'120.6514',radius:'3'},headers:{'x-forwarded-for':lat}});
const res=()=>({status:vi.fn().mockReturnThis(),json:vi.fn(),setHeader:vi.fn()});
beforeEach(()=>{vi.clearAllMocks();catalog.readNearby.mockResolvedValue([]);catalog.getCachedDiscovery.mockResolvedValue(null);catalog.putCachedDiscovery.mockResolvedValue(undefined);catalog.consumeSearchQuota.mockResolvedValue(true)});
describe('cached discovery never pays for enrichment',()=>{
 it('serves durable fresh cache without any external fetch',async()=>{
  catalog.getCachedDiscovery.mockResolvedValue([{...demoRestaurants[0],source:'overture',provenance:[],moderationStatus:'unreviewed'}]);
  const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({elements:[]}));const response=res();
  try{await handler(req('14.99661'),response);expect(fetch).not.toHaveBeenCalled();expect(response.json.mock.calls[0][0].restaurants).toHaveLength(1)}finally{fetch.mockRestore()}
 });
 it('enforces shared quota before provider requests',async()=>{
  catalog.consumeSearchQuota.mockResolvedValue(false);const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({elements:[]}));const response=res();
  try{await handler(req('14.99662'),response);expect(response.status).toHaveBeenCalledWith(429);expect(fetch).not.toHaveBeenCalled()}finally{fetch.mockRestore()}
 });
 it('returns known cached places with a warning during provider outage',async()=>{
  catalog.readNearby.mockResolvedValue([{...demoRestaurants[0],source:'overture',provenance:[],moderationStatus:'unreviewed'}]);
  const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('offline'));const response=res();
  try{await handler(req('14.99663'),response);expect(response.json.mock.calls[0][0].restaurants).toHaveLength(1);expect(response.json.mock.calls[0][0].warnings).toHaveLength(1)}finally{fetch.mockRestore()}
 });
 it('recalculates cached place distance from the current search origin',async()=>{
  catalog.readNearby.mockResolvedValue([{...demoRestaurants[0],lat:15.00664,lng:120.6514,distance:0,source:'overture',provenance:[],moderationStatus:'unreviewed'}]);
  const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('offline'));const response=res();
  try{await handler(req('14.99664'),response);const distance=response.json.mock.calls[0][0].restaurants[0].distance;expect(distance).toBeGreaterThan(1);expect(distance).toBeLessThan(1.2)}finally{fetch.mockRestore()}
 });
});
