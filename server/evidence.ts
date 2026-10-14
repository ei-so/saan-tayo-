export const extractionSchema={type:'object',required:['claims'],additionalProperties:false,properties:{claims:{type:'array',maxItems:40,items:{type:'object',required:['kind','value','quote'],additionalProperties:false,properties:{kind:{type:'string',enum:['cuisine','menu','price','hours','dietary']},value:{type:'string'},quote:{type:'string'},subject:{type:'string'},currency:{type:'string'},unit:{type:'string'}}}}}}
type Claim={kind:string;value:string;quote:string;subject?:string;currency?:string;unit?:string}
export function validateExtraction(output:unknown,sourceText:string):{claims:Claim[];issues:string[];status:'pending_review'}{
 const claims:Claim[]=[],issues:string[]=[]
 if(!output||typeof output!=='object'||!('claims'in output)||!Array.isArray(output.claims)||output.claims.length>40)return{claims,issues:['Invalid claims envelope'],status:'pending_review'}
 for(const [i,raw]of output.claims.entries()){
  if(!raw||typeof raw!=='object'||typeof raw.value!=='string'||typeof raw.quote!=='string'||!['cuisine','menu','price','hours','dietary'].includes(raw.kind)){issues.push(`Claim ${i}: invalid structure`);continue}
  const c=raw as Claim,quote=c.quote.trim(),value=c.value.trim()
  if(!value||value.length>160||!quote||quote.length>500||!sourceText.split(/\r?\n/).some(line=>line.trim()===quote)){issues.push(`Claim ${i}: missing complete exact evidence line`);continue}
  let supported=false
  if(c.kind==='cuisine')supported=quote===`Cuisine: ${value}`
  if(c.kind==='hours')supported=quote===`Opening hours: ${value}` && /\d{1,2}:\d{2}/.test(value)
  if(c.kind==='menu')supported=quote===value||quote.startsWith(`${value} — `)||quote.startsWith(`${value} - `)
  if(c.kind==='price')supported=!!c.subject&&c.currency==='PHP'&&c.unit==='per serving'&&/^(?:0|[1-9]\d{0,4})(?:\.\d{1,2})?$/.test(value)&&Number(value)>0&&(quote===`${c.subject} — PHP ${value} per serving`||quote===`${c.subject} - PHP ${value} per serving`)
  // Options, ingredients, absent allergens and a vendor's claim never establish whole-venue certification.
  if(c.kind==='dietary')supported=(value==='halal'&&quote==='Restaurant is halal-certified.')||(value==='vegetarian'&&quote==='Restaurant serves exclusively vegetarian food.')
  if(!supported){issues.push(`Claim ${i}: ambiguous or unrelated evidence`);continue}
  claims.push(c)
 }
 return{claims,issues,status:'pending_review'}
}
