import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, AudioLines, Camera, Check, Heart, LoaderCircle, Mail, Mic, Music2, Pause, Play, Square, Trash2, Upload, X } from 'lucide-react'
import { createPost, db, errorText, safeMusicUrl, type Nook, type Post } from './lib'
import { Modal, type Action } from './Base'
import { dateInZone, duration, feedback } from './interactions'
import type { Shared } from './useShared'

export type ComposeKind = 'note'|'photo'|'song'|'voice'|'ambient'
export function AudioRecorder({onReady,onActivity}:{onReady:(file:File,seconds:number)=>void;onActivity?:(active:boolean)=>void}) {
  const [recording,setRecording]=useState(false)
  const [requesting,setRequesting]=useState(false)
  const [seconds,setSeconds]=useState(0)
  const [error,setError]=useState('')
  const recorder=useRef<MediaRecorder|null>(null)
  const stream=useRef<MediaStream|null>(null)
  const timer=useRef<number|undefined>(undefined)
  const started=useRef(0)
  const mounted=useRef(true)
  const callback=useRef(onReady);callback.current=onReady
  useEffect(()=>{onActivity?.(recording||requesting);return()=>onActivity?.(false)},[recording,requesting,onActivity])
  const stop=()=>{
    if(recorder.current?.state==='recording') recorder.current.stop()
    else setRecording(false)
    stream.current?.getTracks().forEach(track=>track.stop());stream.current=null
    clearInterval(timer.current)
  }
  useEffect(()=>{
    mounted.current=true
    const hide=()=>{if(document.hidden)stop()}
    document.addEventListener('visibilitychange',hide)
    return ()=>{mounted.current=false;document.removeEventListener('visibilitychange',hide);clearInterval(timer.current);if(recorder.current?.state==='recording')recorder.current.stop();stream.current?.getTracks().forEach(track=>track.stop())}
  },[])
  async function start() {
    setError('');setRequesting(true)
    try {
      if(!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder==='undefined') throw new Error('Recording is not available in this browser. You can upload an audio file below.')
      const media=await navigator.mediaDevices.getUserMedia({audio:true})
      if(!mounted.current){media.getTracks().forEach(track=>track.stop());return}
      stream.current=media
      const mime=['audio/mp4','audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/webm'].find(type=>MediaRecorder.isTypeSupported(type))
      const rec=new MediaRecorder(media,mime?{mimeType:mime}:undefined)
      recorder.current=rec
      const chunks:Blob[]=[]
      let failed=false
      rec.ondataavailable=event=>{if(event.data.size)chunks.push(event.data)}
      rec.onerror=()=>{failed=true;if(mounted.current)setError('The recording was interrupted. Please try again.');stop()}
      rec.onstop=()=>{
        media.getTracks().forEach(track=>track.stop());clearInterval(timer.current)
        if(!mounted.current)return
        setRecording(false)
        if(failed)return
        if(!chunks.length){setError('No audio was captured. Please try again.');return}
        const actual=rec.mimeType.split(';')[0] || 'audio/webm'
        const ext=actual==='audio/mp4'?'m4a':actual==='audio/ogg'?'ogg':'webm'
        const file=new File(chunks,`a-little-whisper.${ext}`,{type:actual})
        if(file.size>10*1024*1024){setError('That recording is too large. Please keep it under a minute.');return}
        callback.current(file,Math.min(60,Math.round((Date.now()-started.current)/1000)));setRecording(false);feedback('success')
      }
      started.current=Date.now();setSeconds(0);setRecording(true);rec.start(250)
      timer.current=window.setInterval(()=>{const elapsed=Math.floor((Date.now()-started.current)/1000);setSeconds(elapsed);if(elapsed>=60)stop()},250)
    } catch(e) {if(mounted.current)setError(e instanceof DOMException && e.name==='NotAllowedError'?'Microphone access was not allowed. Enable it in your browser or upload a recording.':errorText(e));stream.current?.getTracks().forEach(track=>track.stop())}
    finally{if(mounted.current)setRequesting(false)}
  }
  return <div className="recorder">
    <div className={`recording-orb ${recording?'recording':''}`}><Mic aria-hidden="true" /></div>
    <div><strong>{recording?'A little piece of your world…':'Say it in your own voice.'}</strong><p>{recording?`${duration(seconds)} / 1:00`:'A whisper, a song you hum, or the rain outside. Up to one minute.'}</p></div>
    <button type="button" className="button" disabled={requesting} onClick={()=>recording?stop():void start()}>{requesting?<LoaderCircle className="spin"/>:recording?<Square/>:<Mic/>}{recording?'Stop recording':requesting?'Opening microphone…':'Start recording'}</button>
    <label className="audio-upload"><Upload/> Or choose an audio file<input type="file" accept="audio/*" disabled={recording||requesting} onChange={e=>{const file=e.target.files?.[0];if(file){if(file.size>10*1024*1024)setError('Choose a recording smaller than 10 MB.');else{callback.current(file,0);setError('')}}}}/></label>
    {error&&<p className="form-error" role="alert">{error}</p>}
  </div>
}

export function AudioPlayer({post,compact=false}:{post:Post;compact?:boolean}) {
  const ref=useRef<HTMLAudioElement>(null)
  const [playing,setPlaying]=useState(false)
  const [loop,setLoop]=useState(false)
  const [error,setError]=useState('')
  return <div className={`tape-player ${compact?'compact':''}`}>
    <div className={`cassette ${playing?'is-playing':''}`} aria-hidden="true"><div className="cassette-label">{post.kind==='ambient'?'SOUNDS FROM MY SIDE':'A LITTLE WHISPER'}</div><div className="tape-wheels"><i/><span/><i/></div><div className="cassette-bottom"><span>SIDE A</span><span>WITH LOVE</span></div></div>
    <strong className="record-title">{post.metadata?.title|| (post.kind==='ambient'?'A sound from your world':'A little voice note')}</strong>
    {post.image_url?<audio ref={ref} aria-label={post.metadata?.title||'Shared recording'} controls preload="metadata" loop={loop} src={post.image_url} onPlay={()=>{setPlaying(true);setError('')}} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)} onError={()=>{setPlaying(false);setError('This recording could not load. Refresh to renew its private link.')}}/>:<p className="muted">Recording unavailable. Try refreshing.</p>}
    {post.kind==='ambient'&&<label className="checkbox-label"><input type="checkbox" checked={loop} onChange={e=>setLoop(e.target.checked)}/> Loop this little sound</label>}
    {error&&<p className="form-error" role="status">{error}</p>}
  </div>
}

export function Composer({kind:initial,nook,act,busy,close}:{kind:ComposeKind;nook:Nook;act:Action;busy:boolean;close:()=>void}) {
  const [kind,setKind]=useState(initial)
  const [recording,setRecording]=useState(false)
  const [body,setBody]=useState(''),[link,setLink]=useState(''),[file,setFile]=useState<File>(),[error,setError]=useState('')
  const [title,setTitle]=useState(''),[artist,setArtist]=useState(''),[collection,setCollection]=useState(''),[seconds,setSeconds]=useState(0)
  const [preview,setPreview]=useState('')
  const isAudio=kind==='voice'||kind==='ambient'
  useEffect(()=>{if(!file){setPreview('');return}const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url)},[file])
  async function submit(e:FormEvent){
    e.preventDefault();if(recording)return;setError('')
    const url=kind==='song'?safeMusicUrl(link):null
    if(kind==='song'&&!url){setError('Use an https link from Spotify, Apple Music, YouTube, SoundCloud, or Bandcamp.');return}
    if((kind==='photo'||isAudio)&&!file){setError(isAudio?'Record or choose an audio file first.':'Choose a photo first.');return}
    if(kind==='note'&&!body.trim()){setError('Write a little something first.');return}
    if(await act(()=>createPost(nook,kind,body.trim(),url,file,{title:title.trim(),artist:artist.trim(),collection:collection.trim(),duration:seconds}),'Saved to your nook.',setError))close()
  }
  const icons={note:Mail,photo:Camera,song:Music2,voice:Mic,ambient:AudioLines}
  return <Modal title="Leave a little something" close={close} busy={busy}>
    <div className="compose-types" aria-label="What would you like to share?">{(['note','photo','song','voice','ambient'] as const).map(item=>{const Icon=icons[item];return <button type="button" key={item} aria-pressed={kind===item} onClick={()=>{setKind(item);setFile(undefined);setError('')}} disabled={busy||recording}><Icon/>{({note:'Note',photo:'Photo',song:'Music',voice:'Whisper',ambient:'Ambience'})[item]}</button>})}</div>
    <form className="stack-form" onSubmit={submit}>
      {kind==='photo'&&<label className="upload-field"><Camera/><strong>{file?.name||'A moment worth keeping'}</strong><span>JPG, PNG, or WebP · up to 10 MB</span><input type="file" accept="image/jpeg,image/png,image/webp" required onChange={e=>setFile(e.target.files?.[0])}/>{preview&&<img className="upload-preview" src={preview} alt="Your selected photo"/>}</label>}
      {(kind==='song'||isAudio)&&<label>{kind==='song'?'Song or playlist title':'Name this recording'}<input maxLength={120} value={title} onChange={e=>setTitle(e.target.value)} placeholder={kind==='song'?'Our rainy Sunday soundtrack':'Sleepy goodnight'}/></label>}
      {kind==='song'&&<><label>Song or playlist link<input type="url" required value={link} onChange={e=>setLink(e.target.value)} placeholder="https://open.spotify.com/…"/></label><div className="form-columns"><label>Artist <span>(optional)</span><input maxLength={120} value={artist} onChange={e=>setArtist(e.target.value)}/></label><label>Cassette collection<input maxLength={60} list="cassette-names" value={collection} onChange={e=>setCollection(e.target.value)} placeholder="Our favourites"/><datalist id="cassette-names">{[...new Set(nook.posts.map(p=>p.metadata?.collection).filter(Boolean))].map(c=><option key={c} value={c}/>)}</datalist></label></div></>}
      {isAudio&&<><AudioRecorder onActivity={setRecording} onReady={(f,s)=>{setFile(f);setSeconds(s)}}/>{file&&<div className="recording-preview"><Check/><span>{file.name}</span><audio aria-label="Preview your recording" src={preview||undefined} controls/><button type="button" className="text-button" onClick={()=>setFile(undefined)}><X/>Discard recording</button></div>}</>}
      <label>{kind==='song'?'A dedication':kind==='note'?'Your note':'The story behind it (optional)'}<textarea rows={4} maxLength={4000} required={kind==='note'} value={body} onChange={e=>setBody(e.target.value)} placeholder={kind==='song'?'This sounds like you…':'A little piece of my day…'}/></label>
      {error&&<p className="form-error" role="alert">{error}</p>}
      <button className="button full" disabled={busy||recording}>{busy?<LoaderCircle className="spin"/>:<Heart/>}Save to our nook</button>
    </form>
  </Modal>
}

export function PostCard({post,nook,act,busy,shared}:{post:Post;nook:Nook;act:Action;busy:boolean;shared:Shared}) {
  const author=nook.people.find(p=>p.id===post.author_id)
  const music=post.link_url&&safeMusicUrl(post.link_url)
  const hearts=shared.data.hearts.filter(h=>h.post_id===post.id)
  const mine=hearts.some(h=>h.user_id===nook.profile.id)
  return <article className={`post-card ${post.kind}`}>
    {['photo','doodle'].includes(post.kind)&&(post.image_url?<a href={post.image_url} className="photo-link" target="_blank" rel="noreferrer"><img src={post.image_url} loading="lazy" alt={post.body||'A shared memory'}/></a>:<p className="muted">Image unavailable. Refresh to try again.</p>)}
    {post.kind==='note'&&<div className="letterhead"><Mail/><span>JUST BECAUSE</span></div>}
    {post.kind==='song'&&<div className="post-kind"><Music2/><span>{post.metadata?.collection||'A little dedication'}</span></div>}
    {post.kind==='hug'&&<div className="hug-mark"><Heart/><p>{author?.display_name||'Your partner'} left a hug.</p></div>}
    {['voice','ambient'].includes(post.kind)&&<AudioPlayer post={post} compact/>}
    {post.kind==='song'&&post.metadata?.title&&<h3 className="song-title">{post.metadata.title}</h3>}
    {post.body&&<p className="post-body">{post.body}</p>}
    {music&&<a className="music-link" href={music} target="_blank" rel="noopener noreferrer">Open music <ArrowRight/><small>{new URL(music).hostname.replace('www.','')}</small></a>}
    <footer><span className="post-author"><span>{author?.avatar||'♡'}</span>{author?.display_name||'Your partner'}<small>{dateInZone(post.created_at,nook.profile.timezone)}</small></span><div className="memory-actions"><button className={`icon-button ${mine?'hearted':''}`} aria-label={mine?'Remove my heart':'Leave a heart'} aria-pressed={mine} disabled={busy} data-haptic="kiss" onClick={()=>void act(()=>shared.call('heart',{p_post:post.id}))}><Heart fill={mine?'currentColor':'none'}/>{hearts.length>0&&<span>{hearts.length}</span>}</button>{post.author_id===nook.profile.id&&<RemoveMemory post={post} act={act} busy={busy}/>}</div></footer>

  </article>
}

export function RemoveMemory({post,act,busy}:{post:Post;act:Action;busy:boolean}) {
  const [confirm,setConfirm]=useState(false),[error,setError]=useState('')
  async function remove(){
    const ok=await act(async()=>{
      const {error:deleteError}=await db().from('nook_posts').delete().eq('id',post.id);if(deleteError)throw deleteError
      if(post.storage_path){const {error:storageError}=await db().storage.from('nook-memories').remove([post.storage_path]);if(storageError)throw new Error('The memory was removed, but its file could not be cleaned up. Please try again later.')}
    },'Removed from your nook.',setError)
    if(ok)setConfirm(false)
  }
  return <><button className="icon-button" aria-label="Delete this memory" onClick={()=>setConfirm(true)}><Trash2/></button>
    {confirm&&<Modal title="Remove this memory?" busy={busy} close={()=>setConfirm(false)}><p>This removes it from your shared nook.</p>{error&&<p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button className="button secondary" disabled={busy} onClick={()=>setConfirm(false)}>Keep it</button><button className="button danger" disabled={busy} onClick={remove}>Remove</button></div></Modal>}
  </>
}
