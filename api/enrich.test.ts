import {describe,it,expect,vi} from 'vitest'
import handler from './enrich'
describe('protected enrichment endpoint',()=>{
 it.each([{method:'GET',token:'',expected:405},{method:'POST',token:'wrong',expected:401},{method:'POST',token:'test-secret-only',expected:200}])('protects method and secret',async({method,token,expected})=>{process.env.ENRICHMENT_JOB_SECRET='test-secret-only';process.env.ENRICHMENT_ENABLED='false';const res={setHeader:vi.fn(),status:vi.fn().mockReturnThis(),json:vi.fn()};await handler({method,headers:{authorization:`Bearer ${token}`}},res);expect(res.status).toHaveBeenCalledWith(expected)})
})
