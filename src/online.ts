import { createClient } from '@supabase/supabase-js'
import type { Room, Restaurant } from './domain'

const url=import.meta.env.VITE_SUPABASE_URL??''
const key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY??''
// Preview environments must opt in separately and use an isolated Supabase project.
export const onlineEnabled=import.meta.env.VITE_ENABLE_ONLINE==='true' && /^https:\/\/[^/]+\.supabase\.co$/.test(url) && !!key && (import.meta.env.VITE_DEPLOYMENT_ENV!=='preview' || import.meta.env.VITE_ALLOW_PREVIEW_ONLINE==='true')
const client=onlineEnabled?createClient(url,key):null
let userId=''
let identity:Promise<string>|null=null
export async function getOnlineUserId():Promise<string>{
  if(!client) throw new Error('Online rooms are not configured. Try the local demo.')
  if(!identity) identity=(async()=>{const {data,error}=await client.auth.getSession();if(error)throw error;let user=data.session?.user;if(!user){const result=await client.auth.signInAnonymously();if(result.error)throw result.error;user=result.data.user??undefined}if(!user)throw new Error('Could not sign in.');userId=user.id;return userId})().catch(e=>{identity=null;throw e})
  return identity
}
async function rpc(action:string,args:Record<string,unknown>={}) {await getOnlineUserId();const {data,error}=await client!.rpc('saantayo_room',{action,args});if(error)throw new Error(error.message);return data}
const snapshots=new Map<string,Room>()
function remember(room:Room){snapshots.set(room.id,structuredClone(room));return room}
export async function createOnlineRoom(name:string,nickname:string,candidates:Restaurant[]):Promise<Room>{return remember(await rpc('create',{name,nickname,candidates}))}
export async function joinOnlineRoom(code:string,nickname:string):Promise<Room>{return remember(await rpc('join',{code:code.trim().toUpperCase(),nickname}))}
export async function fetchOnlineRoom(id:string):Promise<Room>{return remember(await rpc('read',{id}))}
export async function updateOnlineRoom(room:Room):Promise<Room>{
  const id=await getOnlineUserId(), previous=snapshots.get(room.id)
  if(!previous)throw new Error('Refresh this room before updating it.')
  const me=room.participants.find(p=>p.id===id),old=previous.participants.find(p=>p.id===id)
  if(!me||!old)throw new Error('You are no longer in this room.')
  if(JSON.stringify(me.prefs)!==JSON.stringify(old.prefs)||me.name!==old.name)await rpc('profile',{id:room.id,name:me.name,prefs:me.prefs})
  for(const [restaurant,value] of Object.entries(me.votes))if(value!==old.votes[restaurant])await rpc('vote',{id:room.id,restaurant,value})
  for(const restaurant of Object.keys(old.votes))if(!(restaurant in me.votes))await rpc('undo',{id:room.id,restaurant})
  if(room.hostId===id){
    if(room.status!==previous.status)await rpc(room.status==='voting'?'start':room.status==='finished'?'finish':'restart',{id:room.id,candidates:room.candidates})
    else if(room.status==='waiting'&&JSON.stringify(room.candidates)!==JSON.stringify(previous.candidates))await rpc('candidates',{id:room.id,candidates:room.candidates})
    for(const p of previous.participants)if(!room.participants.some(next=>next.id===p.id))await rpc('remove',{id:room.id,user:p.id})
    if(previous.status==='finished'&&room.status==='finished'&&room.winnerId!==previous.winnerId)await rpc('select',{id:room.id,restaurant:room.winnerId})
  }
  return await fetchOnlineRoom(room.id)
}
export async function removeOnlineParticipant(id:string,user:string){await rpc('remove',{id,user})}
export async function cancelOnlineRoom(id:string){await rpc('cancel',{id})}
export function subscribeRoom(id:string,onRoom:(room:Room)=>void,onError?:(error:Error)=>void):()=>void{
  if(!client)return()=>{}
  let alive=true,busy=false,again=false
  const refresh=async()=>{if(busy){again=true;return}busy=true;try{do{again=false;const room=await fetchOnlineRoom(id);if(alive)onRoom(room)}while(again&&alive)}catch(e){if(alive)onError?.(e as Error)}finally{busy=false}}
  const channel=client.channel(`room:${id}`).on('postgres_changes',{event:'UPDATE',schema:'public',table:'room_events',filter:`id=eq.${id}`},()=>{void refresh()}).subscribe(status=>{if(status==='SUBSCRIBED')void refresh()})
  // Polling repairs reconnect gaps; realtime is a prompt, never a data authority.
  const poll=window.setInterval(()=>{void refresh()},10000)
  return()=>{alive=false;window.clearInterval(poll);void client.removeChannel(channel)}
}
