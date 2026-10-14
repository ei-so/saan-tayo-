import {describe,it,expect,vi} from 'vitest'
import handler,{parseLocation,fetchOverpass} from './discover'
describe('discovery boundary',()=>{
  it('accepts valid coordinates and exact radius maximum',()=>expect(parseLocation({lat:'90',lng:'-180',radius:'10'})).toEqual({lat:90,lng:-180,radius:10}))
  it.each([{lat:' ',lng:'0',radius:'1'},{lat:'NaN',lng:'0',radius:'1'},{lat:'91',lng:'0',radius:'1'},{lat:'0',lng:'181',radius:'1'},{lat:'0',lng:'0',radius:'0'},{lat:'0',lng:'0',radius:'10.01'},{lat:['0'],lng:'0',radius:'1'}])('rejects malformed or excessive search',q=>expect(()=>parseLocation(q)).toThrow())
  it('rejects POST before contacting provider',async()=>{
    const fetch=vi.spyOn(globalThis,'fetch'); const res={status:vi.fn().mockReturnThis(),json:vi.fn(),setHeader:vi.fn()}
    await handler({method:'POST',query:{},headers:{}},res);expect(res.status).toHaveBeenCalledWith(405);expect(fetch).not.toHaveBeenCalled();fetch.mockRestore()
  })
})
describe('bounded provider failover',()=>{
  it('uses one alternative after server failure',async()=>{
    const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response('',{status:503})).mockResolvedValueOnce(Response.json({elements:[]}))
    try{expect(await fetchOverpass('query')).toEqual({elements:[]});expect(fetch).toHaveBeenCalledTimes(2);expect(fetch.mock.calls[1][0]).toBe('https://overpass.private.coffee/api/interpreter')}finally{fetch.mockRestore()}
  })
  it('uses alternative after network timeout',async()=>{
    const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValueOnce(new DOMException('Timed out','TimeoutError')).mockResolvedValueOnce(Response.json({elements:[]}))
    try{await fetchOverpass('query');expect(fetch).toHaveBeenCalledTimes(2)}finally{fetch.mockRestore()}
  })
  it.each([429,406,400])('never retries client errors or quotas (%i)',async status=>{
    const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('',{status}))
    try{await expect(fetchOverpass('query')).rejects.toThrow();expect(fetch).toHaveBeenCalledTimes(1)}finally{fetch.mockRestore()}
  })
  it('makes at most two attempts on network failure',async()=>{
    const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(new TypeError('Network failure'))
    try{await expect(fetchOverpass('query')).rejects.toThrow();expect(fetch).toHaveBeenCalledTimes(2)}finally{fetch.mockRestore()}
  })
})
