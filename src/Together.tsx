import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { ArrowRight, CalendarHeart, Check, Coffee, Fingerprint, Heart, HeartHandshake, Leaf, Mic, Moon, Send, Sparkles, Star, Sun, Touchpad, Waves, Wind } from 'lucide-react'
import { clock, localDay, type Nook, type Profile } from './lib'
import { calendarDays, dayKey, feedback, localHour, stopFeedback, ago, type SignalKind } from './interactions'
import type { Shared } from './useShared'
import type { Action } from './Base'
import type { ComposeKind } from './Media'

const signalWords: Record<SignalKind,string>={touch:'left a little warmth',tap:'sent a gentle tap',warmth:'sent some warmth',wave:'sent a little wave',kiss:'blew a kiss',clink:'clinked a mug with yours',glimmer:'left a star in your sky',hug:'sent a long-distance hug'}
function PersonClock({profile,now,online}:{profile:Profile;now:Date;online:boolean}){
  const hour=localHour(profile,now);const night=hour<6||hour>=19
  return <div className={`horizon-person ${night?'night':'day'}`}><div className="horizon-person-top"><span className="avatar">{profile.avatar}</span><span><strong>{profile.display_name}</strong><small>{profile.city||profile.timezone.replaceAll('_',' ')}</small></span>{night?<Moon/>:<Sun/>}</div><div className="horizon-time">{clock(profile,now)}</div><div className="horizon-meta"><span>{localDay(profile,now)}</span><span className={`presence-label ${online?'online':''}`}><i/>{profile.quiet_mode?'Resting quietly':online?'Here now':'Away for a little while'}</span></div>{profile.status&&<p className="person-status">{profile.status}</p>}</div>
}
export function Horizons({nook,shared}:{nook:Nook;shared:Shared}) {
  const partner=nook.people.find(p=>p.id!==nook.profile.id)
  const online=(id:string)=>Boolean(shared.data.live?.presence.some(p=>p.user_id===id&&shared.now-Date.parse(p.seen_at)<75000))
  return <section className="horizons" aria-label="Your two corners of the world"><div className="section-label"><Heart/> TWO PLACES, ONE LITTLE WORLD</div><div className="horizon-clocks"><PersonClock profile={nook.profile} now={new Date(shared.now)} online={online(nook.profile.id)}/><span className="horizon-thread" aria-hidden="true"><Heart/></span>{partner?<PersonClock profile={partner} now={new Date(shared.now)} online={online(partner.id)}/>:<div className="horizon-waiting"><Moon/><h3>A place for your person.</h3><p>Share your invitation code to bring them home.</p></div>}</div></section>
}

export function TouchPanel({nook,shared,act,compose}:{nook:Nook;shared:Shared;act:Action;compose:(kind:ComposeKind)=>void}) {
  const [holding,setHolding]=useState(false),[sending,setSending]=useState(false),[message,setMessage]=useState('')
  const holdingRef=useRef(false),timer=useRef<number|undefined>(undefined),queue=useRef(Promise.resolve())
  const partner=nook.people.find(p=>p.id!==nook.profile.id)
  const partnerHolding=Boolean(shared.data.live?.presence.find(p=>p.user_id===partner?.id)?.holding_until && Date.parse(shared.data.live!.presence.find(p=>p.user_id===partner?.id)!.holding_until!)>shared.now)
  const both=holding&&partnerHolding
  const received=shared.received&&shared.now-Date.parse(shared.received.created_at)<7000?shared.received:null
  const isMounted=useRef(true)
  const pushHold=(value:boolean)=>{queue.current=queue.current.catch(()=>{}).then(()=>shared.hold(value)).catch(()=>{if(isMounted.current)setMessage('Your touch could not reach the other side. Try again when you are online.')})}
  function end(){if(!holdingRef.current)return;holdingRef.current=false;setHolding(false);clearInterval(timer.current);pushHold(false);stopFeedback()}
  function start(){
    if(!partner||holdingRef.current||shared.loading)return
    holdingRef.current=true;setHolding(true);setMessage('');feedback('warmth');pushHold(true)
    void shared.send('touch').catch(()=>{})
    timer.current=window.setInterval(()=>{if(holdingRef.current)pushHold(true)},3000)
  }
  useEffect(()=>{isMounted.current=true;const hide=()=>{if(document.hidden)end()};document.addEventListener('visibilitychange',hide);return()=>{isMounted.current=false;document.removeEventListener('visibilitychange',hide);clearInterval(timer.current);if(holdingRef.current)void shared.hold(false).catch(()=>{});stopFeedback()}},[])
  useEffect(()=>{if(both)feedback('touch')},[both])
  async function send(kind:SignalKind){
    if(sending||!partner)return;setSending(true)
    const ok=await act(()=>shared.send(kind))
    if(ok){feedback(kind);setMessage(`You ${signalWords[kind]}.`)}setSending(false)
  }
  const gestures=[{kind:'tap',label:'A tiny tap',icon:Touchpad},{kind:'kiss',label:'A kiss',icon:Heart},{kind:'wave',label:'A wave',icon:Waves},{kind:'hug',label:'A hug',icon:HeartHandshake}] as const
  return <section className={`touch-panel ${both?'touch-together':''} ${received?'touch-received':''}`}>
    <div className="touch-heading"><span className="eyebrow">A LITTLE CLOSER</span><span className="tiny-tag"><i className={shared.connected?'live-dot':''}/>{shared.connected?'Connected':'Gentle updates'}</span></div>
    <div className="touch-orbit"><span className="orbit-ring one"/><span className="orbit-ring two"/><span className="orbit-star"><Sparkles/></span><span className="orbit-heart"><Heart/></span><button className={`touch-pebble ${holding?'holding':''}`} aria-label="Hold to share warmth" aria-pressed={holding} disabled={!partner||shared.loading} data-haptic="none" onPointerDown={(e:PointerEvent<HTMLButtonElement>)=>{if(e.button!==0)return;e.currentTarget.setPointerCapture(e.pointerId);start()}} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} onKeyDown={e=>{if((e.key===' '||e.key==='Enter')&&!e.repeat){e.preventDefault();start()}}} onKeyUp={e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();end()}}} onBlur={end}><Fingerprint/><span>{holding?'HERE':'HOLD'}</span></button></div>
    <h2>{both?'There you are. Both of you.':partnerHolding?`${partner?.display_name} is reaching for you.`:holding?'Leaving a little warmth.':'Hold a little closer.'}</h2>
    <p className="touch-description">{both?'Your touches are meeting in the middle.':partner?'Rest your thumb here. When you both hold, your little world lights up.':'Invite your person to meet you here.'}</p>
    <p className="touch-response" role="status">{received?`${partner?.display_name||'Your person'} ${signalWords[received.kind]}.`:message||`${shared.data.live?.state.touch_count||0} little hellos, between you`}</p>
    <div className="gesture-row">{gestures.map(g=><button key={g.kind} className="gesture" data-haptic={g.kind} disabled={!partner||sending||shared.loading} onClick={()=>void send(g.kind)}><span><g.icon/></span>{g.label}</button>)}<button className="gesture" onClick={()=>compose('voice')}><span><Mic/></span>A whisper</button></div>
    <p className="touch-accessibility">Hold with touch, mouse, or the space key. The small buttons work with a single tap.</p>
  </section>
}

export function Balcony({nook,shared,act}:{nook:Nook;shared:Shared;act:Action}) {
  const [pending,setPending]=useState(false),[sent,setSent]=useState<SignalKind|null>(null)
  const partner=nook.people.find(p=>p.id!==nook.profile.id)
  async function send(kind:SignalKind){if(pending)return;setPending(true);if(await act(()=>shared.send(kind))){setSent(kind);feedback(kind)}setPending(false)}
  return <section className="balcony-panel panel"><div className="section-label"><Moon/> OUR SHARED SKY</div><div className={`balcony-scene ${sent==='glimmer'?'glimmered':''}`} aria-hidden="true"><div className="sky-half sky-rose"><span className="sky-moon"/><i className="star-dot s1"/><i className="star-dot s2"/></div><div className="sky-half sky-lilac"><span className="sky-sun"/><i className="star-dot s3"/></div><div className="sky-thread"/><span className="sky-caption">a little window into us</span><div className={`balcony-mugs ${sent==='clink'?'clinked':''}`}><span><Coffee/> yours</span><Heart/><span><Coffee/> theirs</span></div></div><div className="balcony-actions"><button className="button secondary" disabled={!partner||pending||shared.loading} data-haptic="clink" onClick={()=>void send('clink')}><Coffee/>Clink our mugs</button><button className="button secondary" disabled={!partner||pending||shared.loading} data-haptic="glimmer" onClick={()=>void send('glimmer')}><Star/>Send a glimmer</button></div><p className="muted" role="status">{sent==='clink'?'A little cheers, across the distance.':sent==='glimmer'?'Your star is on its way.':'Different windows. A moment we can share.'}</p></section>
}

export function Plant({nook,shared,act,busy}:{nook:Nook;shared:Shared;act:Action;busy:boolean}) {
  const state=shared.data.live?.state
  const watered=shared.data.live?.watered_by.includes(nook.profile.id)
  const count=state?.water_count||0
  const [rename,setRename]=useState(false),[name,setName]=useState('')
  return <section className="plant-panel panel"><div className="section-label"><Leaf/> SOMETHING WE GROW</div><div className="plant-content"><svg className="plant-art" viewBox="0 0 180 200" role="img" aria-label={count===0?'A little seedling':`A growing fern, watered ${count} times`}><ellipse cx="90" cy="185" rx="61" ry="10" fill="var(--line)" opacity=".5"/><path d="M58 134H124L113 180Q90 190 69 180Z" fill="var(--rose)" stroke="var(--accent)" strokeWidth="2"/><path d="M55 130Q90 139 127 130V141Q90 150 55 141Z" fill="var(--accent)"/><path d="M90 132Q92 79 93 39" fill="none" stroke="var(--muted)" strokeWidth="3"/>{Array.from({length:Math.min(7,2+Math.floor(count/2))},(_,i)=>{const y=115-i*12;const side=i%2===0?-1:1;return <path key={i} d={`M92 ${y}Q${92+side*48} ${y-6} ${92+side*39} ${y-34}Q${92+side*3} ${y-36} 92 ${y}`} fill={i%2?'var(--soft)':'var(--lilac)'} stroke="var(--muted)" strokeWidth="1.5"/>})}<path d="M90 48Q69 27 91 12Q112 28 90 48" fill="var(--soft)" stroke="var(--muted)" strokeWidth="1.5"/><Heart x="81" y="158" width="20" height="20" color="var(--accent)"/></svg><div><h2>{state?.plant_name||'Our little fern'}</h2><p>A small act of care, from each of you.</p><span className="plant-stage">{count<4?'A hopeful little sprout':count<14?'Putting down roots':'Growing beautifully'} · {count} waterings</span><button className="button" disabled={busy||watered||shared.loading} onClick={()=>void act(()=>shared.call('water'),'A little care goes a long way.')}><Leaf/>{watered?'Watered with love':'Water our plant'}</button><button className="text-button" onClick={()=>{setName(state?.plant_name||'Our little fern');setRename(!rename)}}>Give it a name</button></div></div>{rename&&<form className="plant-rename" onSubmit={async e=>{e.preventDefault();if(await act(()=>shared.call('ritual_action',{p_action:'plant_name',p_value:name})))setRename(false)}}><label className="sr-only" htmlFor="plant-name">Plant name</label><input id="plant-name" value={name} maxLength={60} required onChange={e=>setName(e.target.value)}/><button className="icon-button" aria-label="Save plant name" disabled={busy}><Check/></button></form>}<p className="footnote">Each of you can water once a day. Your shared day follows {nook.couple?.ritual_timezone||'UTC'}.</p></section>
}

export function Breathe({shared,act,busy}:{shared:Shared;act:Action;busy:boolean}) {
  const start=shared.data.live?.state.breathe_started_at
  const elapsed=start?Math.max(0,shared.now-Date.parse(start)):0
  const active=Boolean(start&&elapsed<180000)
  const inhale=elapsed%8000<4000
  return <section className="breathe-panel panel"><div className="section-label"><Wind/> A QUIET MINUTE, TOGETHER</div><div className="breathing-body"><div className={`breath-orb ${active?(inhale?'inhale':'exhale'):''}`} aria-hidden="true"><Wind/></div><div><h2>{active?(inhale?'Breathe in, gently.':'Let it go, slowly.'):'Take a breath with me.'}</h2><p>{active?`${Math.ceil((180000-elapsed)/1000)} seconds left · follow the shared rhythm`:'A soft three-minute pause. Join the same rhythm whenever you are both here.'}</p></div></div><button className="button secondary" disabled={busy||shared.loading} onClick={()=>void act(()=>shared.call('ritual_action',{p_action:active?'stop_breathe':'breathe'}))}>{active?'End our quiet moment':'Begin a quiet moment'}<Wind/></button><small className="footnote">Breathe at a pace that feels comfortable. You can stop whenever you like.</small></section>
}

export function Milestones({nook,now,settings}:{nook:Nook;now:number;settings:()=>void}) {
  const today=dayKey(nook.couple?.ritual_timezone||nook.profile.timezone,new Date(now))
  const since=nook.couple?.anniversary?calendarDays(nook.couple.anniversary,today):null
  const until=nook.couple?.next_visit?calendarDays(today,nook.couple.next_visit):null
  return <section className="milestones"><div><CalendarHeart/><span>{since===null?'Your story, still unfolding':`${Math.max(0,since).toLocaleString()} days of us`}<small>{since===null?'Add the day your story began.':'All the ordinary days that became ours.'}</small></span></div><div><HeartHandshake/><span>{until===null?'Something to look forward to':until>0?`${until} sleeps until together`:until===0?'Today is your together day.':'A visit worth remembering'}<small>{until===null?'Add your next visit.':'One little day closer.'}</small></span></div><button className="icon-button" aria-label="Edit our dates" onClick={settings}><ArrowRight/></button></section>
}

export function LatestHello({nook,shared}:{nook:Nook;shared:Shared}) {
  const signal=shared.data.live?.signals.find(s=>s.author_id!==nook.profile.id)
  if(!signal)return null
  const name=nook.people.find(p=>p.id===signal.author_id)?.display_name||'Your person'
  return <div className="last-hello"><Send/><span>{name} {signalWords[signal.kind]} <small>{ago(signal.created_at,shared.now)}</small></span></div>
}
