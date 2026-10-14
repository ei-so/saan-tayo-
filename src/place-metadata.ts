import type {Restaurant} from './domain';
export function sourceLabel(r:Restaurant):string{
 if(r.id.startsWith('local-'))return 'Local submission · unverified';
 if(r.source==='demo')return 'Sample place · demonstration only';
 const sources=new Set(r.provenance?.map(p=>p.source)??[r.source]);
 return [sources.has('osm')?'OpenStreetMap':'',sources.has('overture')?'Overture Maps':''].filter(Boolean).join(' + ');
}
export function moderationLabel(r:Restaurant):string{
 return r.moderationStatus==='approved'?'Reviewed record':r.moderationStatus==='pending_review'?'Pending review':r.moderationStatus==='rejected'?'Rejected':'Unreviewed data';
}
export function retrievedLabel(r:Restaurant):string{
 const date=new Date(r.updatedAt);
 return Number.isFinite(date.getTime())?date.toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short'}):'Date unavailable';
}
