import {describe,it,expect,afterEach,vi}from'vitest'
import{readNearby,getCachedDiscovery,putCachedDiscovery,consumeSearchQuota,ingestPlaces}from'./catalog'
describe('unconfigured catalog contracts',()=>{
 afterEach(()=>vi.unstubAllEnvs())
 function disable(){vi.stubEnv('SUPABASE_URL','');vi.stubEnv('SUPABASE_SECRET_KEY','')}
 it('returns empty or misses without server credentials',async()=>{disable();expect(await readNearby(15,120.65,3)).toEqual([]);expect(await getCachedDiscovery(15,120.65,3)).toBeNull();await expect(putCachedDiscovery(15,120.65,3,[])).resolves.toBeUndefined();expect(await consumeSearchQuota('a'.repeat(64))).toBe(true)})
 it('rejects malformed locations and raw identifiers',async()=>{disable();await expect(readNearby(NaN,120,3)).rejects.toThrow();await expect(getCachedDiscovery(15,120,11)).rejects.toThrow();await expect(consumeSearchQuota('127.0.0.1')).rejects.toThrow()})
 it('never pretends an unconfigured import succeeded',async()=>{disable();await expect(ingestPlaces([])).rejects.toThrow('not configured')})
})
