import { useCallback, useEffect, useRef, useState } from 'react'
import { db, errorText, rpc, type Nook } from './lib'
import { feedback, type SignalKind } from './interactions'

export type Envelope = { id:string;author_id:string;title:string;kind:'letter'|'surprise'|'capsule';unlock_at:string;created_at:string;opened_at:string|null;has_audio:boolean }
export type Prompt = { id:string;author_id:string;kind:'daily'|'question'|'either'|'guess';prompt:string;options:string[]|null;audio_post_id:string|null;day_key:string|null;answered_by:string[];created_at:string;answers:{user_id:string;answer:string;created_at:string}[] }
export type Stroke = { id:string;author_id:string;points:[number,number][];color:'rose'|'sage'|'lilac'|'ink';width:number;created_at:string }
export type Signal = { id:string;author_id:string;kind:SignalKind;created_at:string }
export type Live = { server_now:string;day_key:string;presence:{user_id:string;seen_at:string;holding_until:string|null}[];signals:Signal[];watered_by:string[];state:{plant_name:string;water_count:number;touch_count:number;breathe_started_at:string|null;listen_post_id:string|null;listen_playing:boolean;listen_position:number;listen_updated_at:string|null;listen_by:string|null} }
export type SharedData = {live:Live|null;daily_id:string|null;letters:Envelope[];prompts:Prompt[];strokes:Stroke[];hearts:{post_id:string;user_id:string}[]}
const empty: SharedData = {live:null,daily_id:null,letters:[],prompts:[],strokes:[],hearts:[]}
export type Shared = ReturnType<typeof useShared>

export function useShared(nook: Nook) {
  const [data,setData] = useState<SharedData>(empty)
  const [error,setError] = useState('')
  const [loading,setLoading] = useState(true)
  const [connected,setConnected] = useState(false)
  const [received,setReceived] = useState<Signal|null>(null)
  const [offset,setOffset] = useState(0)
  const [tick,setTick] = useState(Date.now())
  const seenSignals=useRef<Set<string>|null>(null)
  const active=useRef(true)
  const ticket=useRef(0)
  const liveTicket=useRef(0)
  const newestLive=useRef(0)
  const profile=useRef(nook.profile); profile.current=nook.profile
  const coupleId=nook.couple?.id
  const acceptLive=useCallback((live:Live|null) => {
    if(!live || !active.current) return
    if(Date.parse(live.server_now)<newestLive.current)return
    newestLive.current=Date.parse(live.server_now)
    setOffset(Date.parse(live.server_now)-Date.now())
    if(seenSignals.current) {
      const fresh=live.signals.find(s=>s.author_id!==profile.current.id && !seenSignals.current!.has(s.id) && Date.parse(live.server_now)-Date.parse(s.created_at)<15000)
      if(fresh) {setReceived(fresh);if(!profile.current.quiet_mode) feedback(fresh.kind)}
    }
    seenSignals.current=new Set(live.signals.map(s=>s.id))
    setData(previous=>({...previous,live}))
  },[])
  const refreshLive=useCallback(async()=>{
    const current=++liveTicket.current
    const live=await rpc<Live>('live_state')
    if(current===liveTicket.current) acceptLive(live)
  },[coupleId,acceptLive])
  const refresh=useCallback(async()=>{
    const current=++ticket.current
    const next=await rpc<SharedData>('rituals')
    if(!active.current || current!==ticket.current) return
    if(next) { setData(previous=>({...next,live:previous.live})); acceptLive(next.live) }
    setError('');setLoading(false)
  },[coupleId,acceptLive])
  useEffect(()=>{
    active.current=true;setLoading(true);seenSignals.current=null;newestLive.current=0
    const update=()=>{void refresh().catch(e=>{if(active.current){setError(errorText(e));setLoading(false)}})}
    const updateLive=()=>{void refreshLive().catch(()=>{if(active.current)setConnected(false)})}
    const ping=()=>{if(!document.hidden)void rpc('ping').then(updateLive).catch(()=>{})}
    update();ping()
    let channel=db().channel(`nook-rituals:${coupleId}:${nook.profile.id}`)
    for(const table of ['nook_presence','nook_signals','nook_ritual_state']) channel=channel.on('postgres_changes',{event:'*',schema:'public',table,filter:`couple_id=eq.${coupleId}`},updateLive)
    for(const table of ['nook_letters','nook_prompts','nook_strokes','nook_hearts']) channel=channel.on('postgres_changes',{event:'*',schema:'public',table,filter:`couple_id=eq.${coupleId}`},update)
    channel.subscribe(status=>{if(active.current)setConnected(status==='SUBSCRIBED')})
    const visibility=()=>{if(!document.hidden){ping();update()}else void rpc('ping',{p_hold:false}).catch(()=>{})}
    const heartbeat=window.setInterval(ping,30000)
    // Reconcile missed events, deleted rows, sleeping tabs, and daily rollover.
    const poll=window.setInterval(()=>{if(!document.hidden){updateLive();update()}},15000)
    const clock=window.setInterval(()=>setTick(Date.now()),1000)
    document.addEventListener('visibilitychange',visibility)
    window.addEventListener('focus',visibility)
    return ()=>{active.current=false;ticket.current++;liveTicket.current++;clearInterval(heartbeat);clearInterval(poll);clearInterval(clock);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('focus',visibility);void db().removeChannel(channel)}
  },[coupleId,nook.profile.id,refresh,refreshLive])
  const call=async<T=unknown>(name:string,args:Record<string,unknown>={})=>{
    const value=await rpc<T>(name,args)
    // A successful write must stay successful if the follow-up read is offline.
    // Callers may otherwise retry a post or delete an already-attached upload.
    await refresh().catch(e=>{if(active.current)setError(errorText(e))})
    return value
  }
  const send=async(kind:SignalKind)=>{await rpc('signal',{p_kind:kind});await refreshLive().catch(()=>{})}
  const hold=async(value:boolean)=>{await rpc('ping',{p_hold:value});await refreshLive().catch(()=>{})}
  return {data,error,loading,connected,received,now:tick+offset,call,send,hold,refresh,refreshLive}
}
