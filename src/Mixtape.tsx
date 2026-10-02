import { useEffect, useRef, useState } from 'react'
import { ArrowRight, AudioLines, Disc3, Headphones, Heart, Mic, Music2, Pause, Play, Plus, RotateCcw } from 'lucide-react'
import { safeMusicUrl, type Nook, type Post } from './lib'
import { Empty, type Action } from './Base'
import { RemoveMemory, PostCard, type ComposeKind } from './Media'
import { dayKey, duration, musicEmbed } from './interactions'
import type { Shared } from './useShared'

function ListeningRoom({post,nook,shared,act,busy}:{post:Post;nook:Nook;shared:Shared;act:Action;busy:boolean}) {
  const ref=useRef<HTMLAudioElement>(null)
  const [joined,setJoined]=useState(false),[error,setError]=useState(''),[length,setLength]=useState(0),[position,setPosition]=useState(0),[seek,setSeek]=useState<number|null>(null),[embed,setEmbed]=useState(false)
  const joinedRef=useRef(false)
  const state=shared.data.live?.state
  const active=state?.listen_post_id===post.id
  const playing=Boolean(active&&state?.listen_playing)
  const audio=post.kind==='voice'||post.kind==='ambient'
  const music=post.link_url&&safeMusicUrl(post.link_url)
  const iframe=music?musicEmbed(music):null
  const expected=()=>Math.max(0,Number(state?.listen_position||0)+(playing&&state?.listen_updated_at?(shared.now-Date.parse(state.listen_updated_at))/1000:0))
  useEffect(()=>{setJoined(false);joinedRef.current=false;setError('');setEmbed(false);setPosition(0);return()=>{ref.current?.pause()}},[post.id])
  useEffect(()=>{
    const player=ref.current
    if(!player||!joinedRef.current)return
    if(!active){player.pause();joinedRef.current=false;setJoined(false);return}
    const target=Math.min(expected(),Number.isFinite(player.duration)?Math.max(0,player.duration-.05):expected())
    if(Math.abs(player.currentTime-target)>1)player.currentTime=target
    if(playing)void player.play().catch(()=>setError('Tap Play together to let this browser play the recording.'))
    else player.pause()
  },[post.id,active,state?.listen_updated_at,state?.listen_playing,joined])
  async function toggle(){
    setError('')
    if(audio){
      const player=ref.current;if(!player)return
      if(!joinedRef.current){
        try{player.currentTime=active?Math.min(expected(),Number.isFinite(player.duration)?player.duration:Infinity):0;await player.play()}
        catch{setError('This recording could not play. Try again or open it from the scrapbook.');return}
        const ok=playing || await act(()=>shared.call('listen',{p_post:post.id,p_playing:true,p_position:player.currentTime}))
        if(ok){joinedRef.current=true;setJoined(true)}else player.pause()
        return
      }
      if(playing)player.pause()
      else try{await player.play()}catch{setError('This recording could not play. Please try again.');return}
      const ok=await act(()=>shared.call('listen',{p_post:post.id,p_playing:!playing,p_position:player.currentTime}))
      if(!ok){if(playing)void player.play().catch(()=>{});else player.pause()}
      return
    }
    await act(()=>shared.call('listen',{p_post:post.id,p_playing:!playing,p_position:0}))
  }
  const cue=active&&state?.listen_updated_at?Math.max(0,Math.ceil((Date.parse(state.listen_updated_at)+5000-shared.now)/1000)):0
  const publisher=nook.people.find(p=>p.id===state?.listen_by)?.display_name||'Your person'
  return <section className="listening-room"><div className="section-label"><Headphones/> A SOUNDTRACK FOR TWO <span className="tiny-tag">{audio?'Our recordings':'Our listening date'}</span></div><div className="turntable-layout"><div className={`record-sleeve ${playing&&joined?'spinning':''}`} aria-hidden="true"><div className="vinyl-record"><div className="vinyl-label"><Heart/><span>our nook</span></div></div><div className="sleeve-cover"><p>FOR YOU,<br/>ALWAYS.</p><div className="sleeve-flower"><Heart/><Heart/><Heart/><Heart/></div><span>A LITTLE MIXTAPE · VOL. 01</span></div></div><div className="listening-copy"><p className="eyebrow">{post.metadata?.collection||'THE SONGS THAT FEEL LIKE US'}</p><h2>{post.metadata?.title|| (audio?'A little sound from our world':'Our shared soundtrack')}</h2>{post.metadata?.artist&&<p className="muted">{post.metadata.artist}</p>}{post.body&&<blockquote>“{post.body}”</blockquote>}<div className="listening-people">{nook.people.map(p=><span key={p.id}><span className="avatar">{p.avatar}</span>{p.display_name}</span>)}</div>
      <div className="listening-controls"><button className="button" disabled={busy||shared.loading||(audio&&!post.image_url)} onClick={()=>void toggle()}>{playing&&(!audio||joined)?<Pause/>:<Play/>}{audio?!joined?'Join & play together':playing?'Pause for both':'Play together':playing?'End listening cue':'Start a listening date'}</button>{audio&&joined&&<button className="icon-button" aria-label="Restart recording for both" disabled={busy} onClick={()=>void act(()=>shared.call('listen',{p_post:post.id,p_playing:playing,p_position:0}))}><RotateCcw/></button>}</div>
      {audio&&<><audio ref={ref} src={post.image_url} preload="metadata" onLoadedMetadata={()=>setLength(ref.current?.duration||0)} onTimeUpdate={()=>setPosition(ref.current?.currentTime||0)} onError={()=>setError('The recording could not load. Refresh to renew its private link.')} onEnded={()=>{if(joinedRef.current&&playing)void act(()=>shared.call('listen',{p_post:post.id,p_playing:false,p_position:0}))}}/><label className="listening-progress"><span className="sr-only">Shared recording position</span><input type="range" min="0" max={Number.isFinite(length)?length:0} step=".1" value={seek??position} disabled={!joined||busy} onChange={e=>setSeek(Number(e.target.value))} onPointerUp={()=>{if(seek!==null)void act(()=>shared.call('listen',{p_post:post.id,p_playing:playing,p_position:seek})).then(()=>setSeek(null))}} onKeyUp={()=>{if(seek!==null)void act(()=>shared.call('listen',{p_post:post.id,p_playing:playing,p_position:seek})).then(()=>setSeek(null))}}/></label><div className="track-times"><span>{duration(seek??position)}</span><span>{duration(Number.isFinite(length)?length:0)}</span></div><p className="footnote">Each of you taps Join once. Play, pause, and seeking then follow the shared recording while this page is open.</p></>}
      {!audio&&<><p className="listening-cue" role="status">{playing?(cue?`${publisher} started a listening date. Press play in ${cue}…`:'Your listening date has begun. Press play in your music app.'):"Pick your song, open it on both sides, then count in together."}</p>{music&&<a className="text-button" href={music} target="_blank" rel="noopener noreferrer">Open in music app <ArrowRight/></a>}{iframe&&<button className="text-button" onClick={()=>setEmbed(!embed)}>{embed?'Close player':'Open player here'}<Disc3/></button>}<p className="footnote">The start cue is shared. Playback and availability follow your music provider.</p></>}
      {error&&<p className="form-error" role="alert">{error}</p>}
    </div></div>{embed&&iframe&&<iframe className="music-embed" title={`Music player: ${post.metadata?.title||'Our shared song'}`} src={iframe} allow="encrypted-media; fullscreen; picture-in-picture" loading="lazy" referrerPolicy="no-referrer"/>}</section>
}

export function Mixtape({nook,shared,act,busy,compose}:{nook:Nook;shared:Shared;act:Action;busy:boolean;compose:(kind:ComposeKind)=>void}) {
  const songs=nook.posts.filter(p=>p.kind==='song')
  const recordings=nook.posts.filter(p=>['voice','ambient'].includes(p.kind))
  const [selected,setSelected]=useState<string|null>(null),[collection,setCollection]=useState('All'),[tab,setTab]=useState('music')
  const current=nook.posts.find(p=>p.id===(selected||shared.data.live?.state.listen_post_id))||songs[0]||recordings[0]
  const collections=[...new Set(songs.map(p=>p.metadata?.collection||'Our favourites'))]
  const today=dayKey(nook.couple?.ritual_timezone||nook.profile.timezone,new Date(shared.now))
  return <><div className="page-tabs" aria-label="Our sounds"><button aria-pressed={tab==='music'} onClick={()=>setTab('music')}>Our mixtapes</button><button aria-pressed={tab==='whispers'} onClick={()=>setTab('whispers')}>Whispers & ambience</button></div>
    {current&&<ListeningRoom key={current.id} post={current} nook={nook} shared={shared} act={act} busy={busy}/>}
    {tab==='music'&&<><div className="section-heading"><div><p className="eyebrow">SIDE A, SIDE B</p><h2>Today’s little song swap.</h2></div></div><div className="daily-swap">{nook.people.map((p,i)=>{const post=songs.find(s=>s.author_id===p.id&&dayKey(nook.couple?.ritual_timezone||nook.profile.timezone,new Date(s.created_at))===today);return <div className="swap-card" key={p.id}><span className="tape-sticker">SIDE {i===0?'A':'B'} · FROM {p.display_name.toLocaleUpperCase()}</span><div className="swap-spools" aria-hidden="true"><i/><Heart/><i/></div>{post?<><h3>{post.metadata?.title||'A song, just for you'}</h3><p>{post.body||'Sometimes a song says it for us.'}</p><button className="text-button" onClick={()=>setSelected(post.id)}><Play/>Put this one on</button></>:<><h3>A little room for a song.</h3><p>{p.id===nook.profile.id?'What sounds like your person today?':'A new dedication will find its way here.'}</p>{p.id===nook.profile.id&&<button className="text-button" onClick={()=>compose('song')}><Music2/>Leave today’s song</button>}</>}</div>})}</div>
      <div className="section-heading"><h2>The cassette crate</h2><span className="muted">{songs.length} {songs.length===1?'dedication':'dedications'}</span></div><div className="filter-chips" aria-label="Cassette collections">{['All',...collections].map(c=><button key={c} aria-pressed={collection===c} onClick={()=>setCollection(c)}>{c}</button>)}</div>
      {songs.length?<div className="music-list">{songs.filter(p=>collection==='All'||(p.metadata?.collection||'Our favourites')===collection).map(p=><article className="music-row" key={p.id}><button className="mini-record" aria-label={`Select ${p.metadata?.title||'this song'}`} onClick={()=>setSelected(p.id)}><Disc3/></button><div><h3>{p.metadata?.title||'A little dedication'}</h3><p>{p.metadata?.artist||nook.people.find(person=>person.id===p.author_id)?.display_name} · {p.metadata?.collection||'Our favourites'}</p>{p.body&&<blockquote>{p.body}</blockquote>}</div><button className="icon-button" aria-label="Listen to this dedication" onClick={()=>setSelected(p.id)}><ArrowRight/></button>{p.author_id===nook.profile.id&&<RemoveMemory post={p} act={act} busy={busy}/>}</article>)}</div>:<Empty icon={<Music2/>} title="What sounds like the two of you?" text="Start with a song and the reason it made you think of them." action={<button className="button" onClick={()=>compose('song')}><Plus/>Add your first song</button>}/>}</>}
    {tab==='whispers'&&<><div className="section-heading"><div><h2>A little sound from your side.</h2><p className="muted">Goodnights, tiny stories, the rain on your window.</p></div><div className="inline-actions"><button className="button" onClick={()=>compose('voice')}><Mic/>Leave a whisper</button><button className="button secondary" onClick={()=>compose('ambient')}><AudioLines/>Save ambience</button></div></div>{recordings.length?<div className="feed-grid">{recordings.map(p=><div key={p.id}><PostCard post={p} nook={nook} shared={shared} act={act} busy={busy}/><button className="text-button" onClick={()=>setSelected(p.id)}><Headphones/>Listen together</button></div>)}</div>:<Empty icon={<Mic/>} title="Your voice makes it feel like home." text="Record a little hello or upload a sound from your day." action={<button className="button" onClick={()=>compose('voice')}><Mic/>Record our first whisper</button>}/>}</>}
  </>
}
