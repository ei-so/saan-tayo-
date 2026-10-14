import {timingSafeEqual,createHash} from 'node:crypto'
import {runEnrichment} from '../server/enrichment.js'
type Response={setHeader(name:string,value:string):void;status(n:number):Response;json(v:unknown):void}
export default async function handler(req:{method?:string;headers:Record<string,string|string[]|undefined>},res:Response){
 res.setHeader('Cache-Control','no-store')
 if(req.method!=='POST'){res.setHeader('Allow','POST');res.status(405).json({error:'POST required'});return}
 const expected=process.env.ENRICHMENT_JOB_SECRET,received=req.headers.authorization
 const digest=(s:string)=>createHash('sha256').update(s).digest()
 if(!expected||typeof received!=='string'||!timingSafeEqual(digest(received),digest(`Bearer ${expected}`))){res.status(401).json({error:'Unauthorized'});return}
 try{res.status(200).json(await runEnrichment())}catch{res.status(503).json({error:'Enrichment unavailable. No automatic retry of uncertain paid attempts.'})}
}
