import { useState, type FormEvent } from 'react'
import { ArrowRight, Clock3, Heart, LockKeyhole, Mail, Mic, Plus, Sparkles } from 'lucide-react'
import { db, errorText, rpc, uploadMedia, type Nook } from './lib'
import { Modal, type Action } from './Base'
import { AudioRecorder } from './Media'
import { dateInZone, feedback } from './interactions'
import type { Envelope, Shared } from './useShared'

type Opened = {locked:boolean;body?:string;storage_path?:string|null;url?:string}
export function EnvelopeComposer({nook,kind,act,busy,shared,close}:{nook:Nook;kind:Envelope['kind'];act:Action;busy:boolean;shared:Shared;close:()=>void}) {
  const [title,setTitle]=useState(''),[body,setBody]=useState(''),[when,setWhen]=useState(kind==='capsule'&&nook.couple?.next_visit?`${nook.couple.next_visit}T12:00`:''),[scheduled,setScheduled]=useState(kind==='capsule'),[audio,setAudio]=useState<File>(),[addAudio,setAddAudio]=useState(false),[error,setError]=useState('')
  const [recording,setRecording]=useState(false)
  async function submit(e:FormEvent){
    e.preventDefault();if(recording)return;setError('')
    if(!body.trim()&&!audio){setError('Leave some words or a recording inside.');return}
    const date=scheduled?new Date(when):new Date()
    if(Number.isNaN(date.getTime())||(scheduled&&date.getTime()<Date.now())){setError('Choose an opening time in the future.');return}
    let path:string|undefined
    const ok=await act(async()=>{
      if(audio)path=await uploadMedia(nook,audio,'nook-envelopes')
      try{await shared.call('create_letter',{p_title:title.trim(),p_body:body.trim(),p_kind:kind,p_unlock:date.toISOString(),p_audio:path||null})}
      catch(e){if(path)await db().storage.from('nook-envelopes').remove([path]);throw e}
    },scheduled?'Sealed, until the right little moment.':'A little something, left for your person.',setError)
    if(ok)close()
  }
  return <Modal title={kind==='capsule'?'A letter for our reunion':kind==='surprise'?'Make a little surprise':'Write a little letter'} busy={busy} close={close}><form className="stack-form" onSubmit={submit}>
    <label>On the outside<input required maxLength={120} value={title} onChange={e=>setTitle(e.target.value)} placeholder={kind==='surprise'?'A date for just the two of us':'For a day when you miss me'}/><small>Your partner can see this title while the envelope is sealed.</small></label>
    <label>{kind==='surprise'?'The surprise inside':'Your letter'}<textarea rows={6} className="letter-input" maxLength={4000} value={body} onChange={e=>setBody(e.target.value)} placeholder={kind==='surprise'?'Tonight: the same tea, the same film, a call that lasts too long.':'My dearest…'}/></label>
    <label className="checkbox-label"><input type="checkbox" checked={addAudio} onChange={e=>{setAddAudio(e.target.checked);if(!e.target.checked)setAudio(undefined)}}/>Tuck a recording inside</label>
    {addAudio&&<><AudioRecorder onActivity={setRecording} onReady={f=>setAudio(f)}/>{audio&&<p className="form-message"><Mic/>{audio.name} is tucked inside.</p>}</>}
    <label className="checkbox-label"><input type="checkbox" checked={scheduled} onChange={e=>setScheduled(e.target.checked)}/>Keep it sealed until a special time</label>
    {scheduled&&<label>Opening time<input type="datetime-local" required value={when} onChange={e=>setWhen(e.target.value)}/><small>Shown in this device’s time zone: {Intl.DateTimeFormat().resolvedOptions().timeZone}. Your partner will see their local equivalent.</small></label>}
    {error&&<p role="alert" className="form-error">{error}</p>}
    <button className="button full" disabled={busy||recording}><Heart/>{scheduled?'Seal with love':'Leave with love'}</button>
  </form></Modal>
}

export function EnvelopeCard({letter,nook,shared}:{letter:Envelope;nook:Nook;shared:Shared}) {
  const [opened,setOpened]=useState<Opened|null>(null),[pending,setPending]=useState(false),[error,setError]=useState('')
  const [scratch,setScratch]=useState(0)
  const locked=Date.parse(letter.unlock_at)>shared.now
  const mine=letter.author_id===nook.profile.id
  const author=nook.people.find(p=>p.id===letter.author_id)?.display_name||'Your person'
  async function open(){
    if(pending||(locked&&!mine))return;setPending(true);setError('')
    try {
      const result=await rpc<Opened>('read_letter',{p_id:letter.id})
      if(result.locked){setError('Still sealed. Your envelope will open at the time above.');return}
      if(result.storage_path){const {data,error:e}=await db().storage.from('nook-envelopes').createSignedUrl(result.storage_path,300);if(e)throw e;result.url=data.signedUrl}
      setOpened(result);feedback('success');void shared.refresh().catch(()=>{})
    }catch(e){setError(errorText(e))}finally{setPending(false)}
  }
  return <article className={`envelope-card ${letter.kind}`}>
    <div className="envelope-top"><span>{letter.kind==='capsule'?'FOR WHEN WE MEET':letter.kind==='surprise'?'A LITTLE SURPRISE':'AIR MAIL · WITH LOVE'}</span>{letter.has_audio?<Mic/>:<Mail/>}</div>
    <div className="envelope-fold" aria-hidden="true"/><div className="wax-seal" aria-hidden="true">{locked?<LockKeyhole/>:<Heart/>}</div>
    <h3>{letter.title}</h3><p>From {author}</p>
    <div className="envelope-time"><Clock3/>{locked?`Opens ${dateInZone(letter.unlock_at,nook.profile.timezone)}`:letter.opened_at?'Opened with love':'Ready for a quiet moment'}</div>
    {letter.kind==='surprise'&&!locked&&!mine?<div className="scratch-ticket" style={{backgroundSize:`${Math.min(100,scratch*12)}% 100%`}} onPointerMove={e=>{if(e.buttons!==1||pending)return;setScratch(v=>v+1);if(scratch>8)void open()}}><Sparkles/><span>Brush a finger across, or tap below.</span><button className="button secondary" disabled={pending} onClick={()=>void open()}>{pending?'Opening…':'Reveal our surprise'}<ArrowRight/></button></div>:<button className="button secondary" disabled={pending||(locked&&!mine)} onClick={()=>void open()}>{pending?'Opening…':mine&&locked?'Read my sealed letter':locked?'Waiting for its moment':'Break the little seal'}{locked&&!mine?<LockKeyhole/>:<ArrowRight/>}</button>}
    {error&&<p className="form-error" role="alert">{error}</p>}
    {opened&&<Modal title={letter.title} close={()=>setOpened(null)} busy={false}><div className="opened-letter"><p className="eyebrow">FROM {author.toLocaleUpperCase()}</p><p>{opened.body}</p>{opened.url&&<audio controls autoPlay={false} src={opened.url} aria-label="Recording inside this letter"/>}<Heart/></div></Modal>}
  </article>
}

export function LetterShelf({nook,shared,act,busy,surprises=false}:{nook:Nook;shared:Shared;act:Action;busy:boolean;surprises?:boolean}) {
  const [create,setCreate]=useState<Envelope['kind']|null>(null)
  const letters=shared.data.letters.filter(l=>surprises?l.kind==='surprise':l.kind!=='surprise')
  return <div className="letter-shelf"><div className="section-heading"><div><h2>{surprises?'A little surprise, just for us.':'Letters for the right moment.'}</h2><p className="muted">{surprises?'A date idea, a promise, a tiny adventure.':'Open now, on a sleepy morning, or when you finally meet.'}</p></div><div className="inline-actions"><button className="button" onClick={()=>setCreate(surprises?'surprise':'letter')}><Plus/>{surprises?'Make a surprise':'Write a letter'}</button>{!surprises&&<button className="button secondary" onClick={()=>setCreate('capsule')}><LockKeyhole/>Reunion capsule</button>}</div></div>
    {letters.length?<div className="envelope-grid">{letters.map(letter=><EnvelopeCard key={letter.id} letter={letter} nook={nook} shared={shared}/>)}</div>:<div className="letter-empty"><Mail/><h3>A little space for your words.</h3><p>Leave something they can hold onto, even from far away.</p></div>}
    {create&&<EnvelopeComposer nook={nook} kind={create} act={act} busy={busy} shared={shared} close={()=>setCreate(null)}/>}
  </div>
}
