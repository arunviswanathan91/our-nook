import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import type { Session } from '@supabase/supabase-js'
import { ArrowRight, BookHeart, Camera, Disc3, Gamepad2, Heart, Home, KeyRound, Leaf, LogOut, Mail, Plus, Search, Send, Settings, ShieldCheck, Sparkles } from 'lucide-react'
import { signOut, type Nook } from './lib'
import { Brand } from './Brand'
import { PasswordPanel } from './Auth'
import { CoupleForm, Empty, InviteCode, Notice, ProfileForm, TelegramConnect, type Action } from './Base'
import { Composer, PostCard, type ComposeKind } from './Media'
import { Balcony, Breathe, Horizons, LatestHello, Milestones, Plant, TouchPanel } from './Together'
import { LetterShelf } from './Letters'
import { Mixtape } from './Mixtape'
import { Parlour } from './Parlour'
import { useShared, type Shared } from './useShared'
import { configureFeedback, dayKey, installFeedback } from './interactions'

type Page='today'|'keepsakes'|'mixtape'|'play'|'settings'
const navigation=[{id:'today',label:'Together',icon:Home},{id:'keepsakes',label:'Scrapbook',icon:BookHeart},{id:'mixtape',label:'Mixtape',icon:Disc3},{id:'play',label:'Parlour',icon:Gamepad2}] as const
const headings={today:'A little time for us.',keepsakes:'The little things, kept.',mixtape:'Sounds like us.',play:'A little play. A little us.',settings:'Make yourselves at home.'}
const subtitles={today:'A place to meet, even when the world keeps you apart.',keepsakes:'A collection of ordinary moments that became our favourites.',mixtape:'The songs, sleepy whispers, and little sounds that bring you closer.',play:'Questions, tiny adventures, and a little room to be silly.',settings:'All the details that make this little place yours.'}

export function Dashboard({nook,session,act,busy,notice,setNotice,invite,setInvite,makeInvite,postLimit,setPostLimit}:{nook:Nook;session:Session;act:Action;busy:boolean;notice:{text:string;error:boolean}|null;setNotice:Dispatch<SetStateAction<{text:string;error:boolean}|null>>;invite:string|null;setInvite:Dispatch<SetStateAction<string|null>>;makeInvite:()=>Promise<void>;postLimit:number;setPostLimit:Dispatch<SetStateAction<number>>}) {
  const [page,setPage]=useState<Page>('today'),[compose,setCompose]=useState<ComposeKind|null>(null)
  const shared=useShared(nook)
  const partner=nook.people.find(p=>p.id!==nook.profile.id)
  useEffect(()=>configureFeedback(nook.profile),[nook.profile.haptics,nook.profile.quiet_mode])
  useEffect(()=>installFeedback(),[])
  useEffect(()=>{const pages:Page[]=['today','keepsakes','mixtape','play','settings'];const change=()=>{const next=window.location.hash.slice(1) as Page;if(pages.includes(next))setPage(next)};change();window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change)},[])
  function navigate(next:Page){setPage(next);setNotice(null);window.location.hash=next;window.scrollTo({top:0,behavior:'instant'})}
  const daily=shared.data.prompts.find(p=>p.id===shared.data.daily_id)
  return <div className="app-shell dearest">
    <a className="skip-link" href="#main-content">Skip to our space</a>
    <aside className="sidebar"><div><Brand/><p className="brand-caption">a little home for two</p></div><nav aria-label="Main navigation">{navigation.map(item=><button key={item.id} className={`nav-item ${page===item.id?'active':''}`} aria-current={page===item.id?'page':undefined} onClick={()=>navigate(item.id)}><item.icon/><span>{item.label}</span>{page===item.id&&<i/>}</button>)}</nav><div className="sidebar-love" aria-hidden="true"><span className="pressed-flower"><Leaf/><Leaf/><Leaf/></span><p>All the little things.<br/><em>All in one place.</em></p></div><div className="sidebar-bottom"><div className="small-label"><ShieldCheck/>Just the two of you</div><button className="account-button" aria-label="Your profile and settings" onClick={()=>navigate('settings')}><span className="avatar">{nook.profile.avatar}</span><span>{nook.profile.display_name}<small>{nook.profile.city||'Your corner of the world'}</small></span><Settings/></button></div></aside>
    <div className="workspace"><header className="topbar"><div className="mobile-brand"><Brand/></div><span className="space-name"><Heart/>{nook.couple?.title}</span><div className="topbar-actions"><span className="top-companions" aria-label="The two of you">{nook.people.map(p=><span className="avatar" key={p.id} title={p.display_name}>{p.avatar}</span>)}</span><button className="icon-button" aria-label="Our space" onClick={()=>navigate('settings')}><Settings/></button><button className="icon-button" aria-label="Sign out" onClick={()=>void act(()=>signOut())}><LogOut/></button></div></header>
      <main id="main-content"><div className="page-heading"><div><p className="eyebrow">{page==='today'?`HELLO, ${nook.profile.display_name.toLocaleUpperCase()}`:page==='settings'?'OUR SPACE':navigation.find(n=>n.id===page)?.label.toLocaleUpperCase()}</p><h1>{headings[page]}</h1><p className="page-subtitle">{subtitles[page]}</p></div>{['today','keepsakes','mixtape'].includes(page)&&<button className="button" onClick={()=>setCompose(page==='mixtape'?'song':'note')}><Plus/>{page==='mixtape'?'Add music':'Leave something'}</button>}</div>
        {notice&&<Notice notice={notice} close={()=>setNotice(null)}/>}
        {shared.error&&<div className="shared-error" role="status"><p>Your shared rituals could not refresh. {shared.error}</p><button className="text-button" onClick={()=>void shared.refresh().catch(()=>{})}>Try again <ArrowRight/></button></div>}
        {!partner&&<div className="invite-banner"><div><KeyRound/><span><strong>One little code. Your person, here.</strong><small>Invite your partner to share this nook.</small></span></div><button className="button secondary" disabled={busy} onClick={makeInvite}>Get invite code</button></div>}
        {invite&&<InviteCode code={invite} dismiss={()=>setInvite(null)}/>}
        {page==='today'&&<><Horizons nook={nook} shared={shared}/><div className="sanctuary-grid"><TouchPanel nook={nook} shared={shared} act={act} compose={setCompose}/><div className="sanctuary-side"><Balcony nook={nook} shared={shared} act={act}/><LatestHello nook={nook} shared={shared}/><button className="daily-preview" onClick={()=>navigate('play')}><span className="mini-wax"><Mail/></span><span><small>A QUESTION, JUST FOR US</small><strong>{daily?.prompt||'A little curiosity brings us closer.'}</strong><span>{daily?.answered_by.length===2?'Your two answers are waiting.':daily?.answered_by.includes(nook.profile.id)?'Your answer is sealed with love.':'Leave a little piece of your mind.'}</span></span><ArrowRight/></button></div></div><Milestones nook={nook} now={shared.now} settings={()=>navigate('settings')}/><div className="ritual-grid"><Plant nook={nook} shared={shared} act={act} busy={busy}/><Breathe shared={shared} act={act} busy={busy}/></div><div className="section-heading"><h2>Recently, between us</h2><button className="text-button" onClick={()=>navigate('keepsakes')}>All keepsakes <ArrowRight/></button></div>{nook.posts.length?<div className="feed-grid recent-feed">{nook.posts.filter(p=>p.kind!=='song').slice(0,3).map(post=><PostCard key={post.id} post={post} nook={nook} shared={shared} act={act} busy={busy}/>)}</div>:<Empty icon={<Sparkles/>} title="Start with one small thing." text="A photo of your day, a song on repeat, or a note just because." action={<button className="button secondary" onClick={()=>setCompose('photo')}><Camera/>Add your first memory</button>}/>}</>}
        {page==='keepsakes'&&<Scrapbook nook={nook} shared={shared} act={act} busy={busy} compose={setCompose} postLimit={postLimit} loadMore={()=>setPostLimit(n=>n+60)}/>}
        {page==='mixtape'&&<><Mixtape nook={nook} shared={shared} act={act} busy={busy} compose={setCompose}/>{nook.posts.length>=postLimit&&<button className="button secondary load-more" onClick={()=>setPostLimit(n=>n+60)}>Load older songs</button>}</>}
        {page==='play'&&<Parlour nook={nook} shared={shared} act={act} busy={busy}/>}
        {page==='settings'&&<div className="settings-grid"><section className="panel"><h2>Your corner</h2><ProfileForm profile={nook.profile} act={act} busy={busy}/></section><div><section className="panel"><h2>Your shared space</h2><CoupleForm couple={nook.couple!} act={act} busy={busy}/>{!partner&&<button className="text-button" disabled={busy} onClick={makeInvite}><KeyRound/>Create a fresh partner code</button>}</section><PasswordPanel email={session.user.email}/><section className="panel telegram-panel"><h2><Send/>Telegram pocket inbox</h2><TelegramConnect act={act} busy={busy}/></section><section className="panel install-panel"><h2>Keep us close</h2><p>On iPhone, use your browser’s Share menu, then Add to Home Screen. On Android, use Install app or Add to Home Screen in the browser menu.</p></section></div></div>}
        <footer className="nook-footer"><Heart/><span>A little closer, wherever you are.</span></footer>
      </main>
    </div><nav className="mobile-nav" aria-label="Mobile navigation">{navigation.map(item=><button key={item.id} className={page===item.id?'active':''} aria-current={page===item.id?'page':undefined} onClick={()=>navigate(item.id)}><item.icon/><span>{item.label}</span></button>)}</nav>
    {compose&&<Composer kind={compose} nook={nook} act={act} busy={busy} close={()=>setCompose(null)}/>}
  </div>
}

function Scrapbook({nook,shared,act,busy,compose,postLimit,loadMore}:{nook:Nook;shared:Shared;act:Action;busy:boolean;compose:(kind:ComposeKind)=>void;postLimit:number;loadMore:()=>void}) {
  const [tab,setTab]=useState('memories'),[filter,setFilter]=useState('all'),[search,setSearch]=useState('')
  const today=dayKey(nook.profile.timezone,new Date(shared.now))
  const onThisDay=nook.posts.find(p=>['photo','note','doodle'].includes(p.kind)&&dayKey(nook.profile.timezone,new Date(p.created_at)).slice(5)===today.slice(5)&&dayKey(nook.profile.timezone,new Date(p.created_at)).slice(0,4)!==today.slice(0,4))
  const posts=nook.posts.filter(p=>p.kind!=='song'&&(filter==='all'||filter===p.kind||(filter==='audio'&&['voice','ambient'].includes(p.kind))||(filter==='loved'&&shared.data.hearts.some(h=>h.post_id===p.id&&h.user_id===nook.profile.id)))&&`${p.body} ${p.metadata?.title||''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  return <><div className="page-tabs" aria-label="Our keepsakes"><button aria-pressed={tab==='memories'} onClick={()=>setTab('memories')}>All our keepsakes</button><button aria-pressed={tab==='letters'} onClick={()=>setTab('letters')}>Letters & capsules</button></div>
    {tab==='letters'?<LetterShelf nook={nook} shared={shared} act={act} busy={busy}/>:<><div className="scrapbook-tools"><div className="inline-actions"><button className="button secondary" onClick={()=>compose('photo')}><Camera/>Add a photo</button><button className="button secondary" onClick={()=>compose('note')}><Mail/>Write a note</button></div><label className="search-box"><Search/><span className="sr-only">Find a keepsake</span><input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Find a little memory…"/></label></div>
      {onThisDay&&!search&&filter==='all'&&<section className="on-this-day"><span><Sparkles/>ON THIS DAY</span><p>A little piece of your past, finding you again.</p><PostCard post={onThisDay} nook={nook} shared={shared} act={act} busy={busy}/></section>}
      <div className="filter-chips" aria-label="Filter keepsakes">{[['all','All fragments'],['photo','Photographs'],['note','Little notes'],['doodle','Drawings'],['audio','Spoken whispers'],['loved','Loved by me']].map(([id,label])=><button key={id} aria-pressed={filter===id} onClick={()=>setFilter(id)}>{label}</button>)}</div>
      {posts.length?<div className="feed-grid scrapbook-grid">{posts.map(post=><PostCard key={post.id} post={post} nook={nook} shared={shared} act={act} busy={busy}/>)}</div>:<Empty icon={<BookHeart/>} title={search?'No little memories found.':'A little space for your story.'} text={search?'Try another word or choose a different filter.':'Keep the things you want to come back to.'}/>}
      {nook.posts.length>=postLimit&&<button className="button secondary load-more" onClick={loadMore}>Load older memories</button>}
    </>}
  </>
}
