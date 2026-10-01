import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { ArrowRight, Camera, Check, Copy, Gamepad2, Heart, HeartHandshake, Home, Image, KeyRound, Link, LoaderCircle, LogOut, Mail, Music2, Plus, Send, Settings, ShieldCheck, Sparkles, Trash2, Users, X } from 'lucide-react'
import { botUsername, clock, configured, createPost, db, deviceTimezone, errorText, loadNook, localDay, rpc, safeMusicUrl, supabase, validTimezone, type Couple, type Nook, type Post, type Profile } from './lib'

type Page = 'today' | 'keepsakes' | 'mixtape' | 'play' | 'settings'
type Action = (work: () => Promise<unknown>, message?: string, onError?: (message: string) => void) => Promise<boolean>
const navigation = [{ id: 'today', label: 'Today', icon: Home }, { id: 'keepsakes', label: 'Keepsakes', icon: Image }, { id: 'mixtape', label: 'Mixtape', icon: Music2 }, { id: 'play', label: 'Play', icon: Gamepad2 }, { id: 'settings', label: 'Our space', icon: Settings }] as const

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [booting, setBooting] = useState(true)
  const [nook, setNook] = useState<Nook | null>(null)
  const [page, setPage] = useState<Page>('today')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  const [compose, setCompose] = useState<'note' | 'photo' | 'song' | null>(null)
  const [invite, setInvite] = useState<string | null>(null)
  const [postLimit, setPostLimit] = useState(60)
  const [now, setNow] = useState(new Date())
  const activeUser = useRef<string | null>(null)
  const refreshTicket = useRef(0)
  const mutationLock = useRef(false)

  useEffect(() => {
    if (!supabase) { setBooting(false); return }
    supabase.auth.getSession().then(({ data, error }) => { if (error) setNotice({ text: error.message, error: true }); setSession(data.session); setBooting(false) })
    const { data } = supabase.auth.onAuthStateChange((_event, value) => { setSession(value); if (!value) { activeUser.current = null; setNook(null); setInvite(null); setPage('today') } })
    return () => data.subscription.unsubscribe()
  }, [])
  const refresh = useCallback(async () => {
    if (!session) return
    const user = session.user.id
    const ticket = ++refreshTicket.current
    const next = await loadNook(user, postLimit)
    if (activeUser.current === user && ticket === refreshTicket.current) setNook(next)
  }, [session?.user.id, postLimit])
  useEffect(() => {
    activeUser.current = session?.user.id || null
    if (!session) return
    void refresh().catch(error => setNotice({ text: errorText(error), error: true }))
  }, [session?.user.id, refresh])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    if (!nook?.couple || !supabase) return
    const id = nook.couple.id
    const update = () => { void refresh().catch(() => {}) }
    const channel = supabase.channel(`nook:${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'nook_posts', filter: `couple_id=eq.${id}` }, update)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'nook_games', filter: `couple_id=eq.${id}` }, update)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'nook_members', filter: `couple_id=eq.${id}` }, update)
      .subscribe()
    const onFocus = () => { if (!document.hidden) update() }
    const timer = window.setInterval(onFocus, 60000)
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); void supabase?.removeChannel(channel) }
  }, [nook?.couple?.id, refresh])
  useEffect(() => { document.documentElement.dataset.theme = nook?.profile.theme || 'rose' }, [nook?.profile.theme])

  const act: Action = async (work, message, onError) => {
    if (mutationLock.current) return false
    mutationLock.current = true; setBusy(true); setNotice(null)
    try {
      await work()
      try { await refresh() } catch { setNotice({ text: 'Saved, but the latest view could not load. Refresh when you are back online.', error: true }); return true }
      if (message) setNotice({ text: message, error: false })
      return true
    } catch (error) { const text = errorText(error); setNotice({ text, error: true }); onError?.(text); return false }
    finally { mutationLock.current = false; setBusy(false) }
  }
  async function makeInvite() {
    await act(async () => { const result = await rpc<{ code: string }>('issue_invite'); setInvite(result.code) })
  }

  if (booting) return <div className="full-center"><LoaderCircle className="spin" aria-label="Opening Our Nook" /></div>
  if (!session) return <AuthScreen />
  if (!nook) return <div className="full-center"><Brand /><p>{notice?.text || 'Opening your little corner…'}</p><button className="button" onClick={() => void act(refresh)}>Try again</button><button className="text-button" onClick={() => void db().auth.signOut()}>Sign out</button></div>
  if (!nook.couple) return <div className="onboarding-page"><Brand />{notice && <Notice notice={notice} close={() => setNotice(null)} />}<Onboarding profile={nook.profile} act={act} busy={busy} joined={() => setPage('today')} invite={setInvite} /><button className="text-button" onClick={() => void act(() => db().auth.signOut())}><LogOut /> Sign out</button></div>

  const partner = nook.people.find(p => p.id !== nook.profile.id)
  const title = { today: 'A little time for us.', keepsakes: 'The little things, kept.', mixtape: 'Sounds like us.', play: 'Your move, sweetheart.', settings: 'Make yourselves at home.' }[page]
  return <div className="app-shell">
    <aside className="sidebar"><Brand /><nav aria-label="Main navigation">{navigation.map(item => <button key={item.id} className={page === item.id ? 'nav-item active' : 'nav-item'} aria-current={page === item.id ? 'page' : undefined} onClick={() => { setPage(item.id); setNotice(null) }}><item.icon /><span>{item.label}</span></button>)}</nav><div className="sidebar-bottom"><div className="small-label"><ShieldCheck /> Private space for two</div><button className="account-button" onClick={() => setPage('settings')}><span className="avatar">{nook.profile.avatar}</span><span>{nook.profile.display_name}<small>{nook.profile.city || 'Your corner of the world'}</small></span></button></div></aside>
    <div className="workspace">
      <header className="topbar"><div className="mobile-brand"><Brand /></div><span className="space-name">{nook.couple.title}</span><span className="top-date">{localDay(nook.profile, now)}</span><button className="icon-button" aria-label="Sign out" onClick={() => void act(() => db().auth.signOut())}><LogOut /></button></header>
      <main>
        <div className="page-heading"><div><p className="eyebrow">{page === 'today' ? `HELLO, ${nook.profile.display_name.toLocaleUpperCase()}` : navigation.find(n => n.id === page)?.label.toUpperCase()}</p><h1>{title}</h1></div>{['today','keepsakes','mixtape'].includes(page) && <button className="button" onClick={() => setCompose(page === 'mixtape' ? 'song' : 'note')}><Plus /><span>{page === 'mixtape' ? 'Add music' : 'Leave something'}</span></button>}</div>
        {notice && <Notice notice={notice} close={() => setNotice(null)} />}
        {!partner && <div className="invite-banner"><div><KeyRound /><span><strong>One little code. Your person, here.</strong><small>Invite your partner to share this nook.</small></span></div><button className="button secondary" disabled={busy} onClick={makeInvite}>Get invite code</button></div>}
        {invite && <InviteCode code={invite} dismiss={() => setInvite(null)} />}
        {page === 'today' && <>
          <div className="today-grid">
            <section className="panel together-panel"><div className="section-label"><Heart /> SAME LITTLE WORLD</div><div className="clock-row"><PersonClock profile={nook.profile} now={now} /><span className="clock-heart"><Heart /></span>{partner ? <PersonClock profile={partner} now={now} /> : <div className="person-clock"><span className="avatar waiting"><Users /></span><h3>Your person</h3><p>Their place is waiting.</p></div>}</div><div className="together-footer"><span>{partner ? 'A small hello can go a long way.' : 'A home for your everyday moments.'}</span><button className="button" disabled={busy || !partner} onClick={() => void act(() => createPost(nook, 'hug'), 'Left a hug in your nook.')}><HeartHandshake /> Send a hug</button></div></section>
            <section className="panel note-panel"><div className="section-label"><Mail /> A LITTLE NOTE</div><QuickNote nook={nook} act={act} busy={busy} /></section>
          </div>
          <div className="section-heading"><h2>Recently, between us</h2><button className="text-button" onClick={() => setPage('keepsakes')}>All keepsakes <ArrowRight /></button></div>
          {nook.posts.length ? <div className="feed-grid">{nook.posts.slice(0, 6).map(post => <PostCard key={post.id} post={post} nook={nook} act={act} busy={busy} />)}</div> : <Empty icon={<Sparkles />} title="Start with one small thing." text="A photo of your day, a song on repeat, or a note just because." action={<button className="button secondary" onClick={() => setCompose('photo')}><Camera /> Add your first memory</button>} />}
          <div className="little-links"><button onClick={() => setPage('play')}><Gamepad2 /><span>A tiny game for two<small>Take your turn whenever you can.</small></span><ArrowRight /></button><button onClick={() => setPage('mixtape')}><Music2 /><span>Put a song in their day<small>A link, a dedication, a little you.</small></span><ArrowRight /></button></div>
        </>}
        {page === 'keepsakes' && <>
          <div className="inline-actions"><button className="button secondary" onClick={() => setCompose('photo')}><Camera /> Add a photo</button><button className="button secondary" onClick={() => setCompose('note')}><Mail /> Write a note</button></div>
          {nook.posts.filter(p => p.kind !== 'song').length ? <div className="feed-grid">{nook.posts.filter(p => p.kind !== 'song').map(post => <PostCard key={post.id} post={post} nook={nook} act={act} busy={busy} />)}</div> : <Empty icon={<Image />} title="Your story starts here." text="Keep the moments you want to come back to." />}
          {nook.posts.length >= postLimit && <button className="button secondary load-more" onClick={() => setPostLimit(n => n + 60)}>Load older memories</button>}
        </>}
        {page === 'mixtape' && <>
          <div className="mixtape-intro"><div className="record-icon"><Music2 /></div><div><h2>Our shared soundtrack</h2><p>Spotify, Apple Music, YouTube, SoundCloud, or Bandcamp. Add the song and the reason.</p></div></div>
          {nook.posts.filter(p => p.kind === 'song').length ? <div className="feed-grid">{nook.posts.filter(p => p.kind === 'song').map(post => <PostCard key={post.id} post={post} nook={nook} act={act} busy={busy} />)}</div> : <Empty icon={<Music2 />} title="What sounds like the two of you?" text="Start a mixtape with a song or a whole playlist." action={<button className="button" onClick={() => setCompose('song')}><Plus /> Add your first song</button>} />}
          {nook.posts.length >= postLimit && <button className="button secondary load-more" onClick={() => setPostLimit(n => n + 60)}>Load older songs</button>}
        </>}
        {page === 'play' && <GamePanel nook={nook} act={act} busy={busy} />}
        {page === 'settings' && <div className="settings-grid"><section className="panel"><h2>Your corner</h2><ProfileForm profile={nook.profile} act={act} busy={busy} /></section><div><section className="panel"><h2>Your shared space</h2><CoupleForm couple={nook.couple} act={act} busy={busy} />{!partner && <button className="text-button" disabled={busy} onClick={makeInvite}><KeyRound /> Create a fresh partner code</button>}</section><section className="panel telegram-panel"><h2><Send /> Telegram pocket inbox</h2><TelegramConnect act={act} busy={busy} /></section><section className="panel install-panel"><h2>Keep us close</h2><p>On iPhone, use your browser’s Share menu, then Add to Home Screen. On Android, use Install app or Add to Home Screen in the browser menu.</p></section></div></div>}
      </main>
    </div>
    <nav className="mobile-nav" aria-label="Mobile navigation">{navigation.map(item => <button key={item.id} className={page === item.id ? 'active' : ''} aria-current={page === item.id ? 'page' : undefined} onClick={() => setPage(item.id)}><item.icon /><span>{item.label}</span></button>)}</nav>
    {compose && <Composer kind={compose} nook={nook} act={act} busy={busy} close={() => setCompose(null)} />}
  </div>
}

function Brand() { return <div className="brand"><span className="brand-mark"><Heart fill="currentColor" /></span><span>our nook<span className="brand-dot">.</span></span></div> }
function Notice({ notice, close }: { notice: { text: string; error: boolean }; close: () => void }) { return <div className={`notice ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}><span>{notice.text}</span><button className="icon-button" aria-label="Dismiss message" onClick={close}><X /></button></div> }
function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) { return <div className="empty-state"><span className="empty-icon">{icon}</span><h2>{title}</h2><p>{text}</p>{action}</div> }

function AuthScreen() {
  const [email, setEmail] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [sent, setSent] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try { const { error: e } = await db().auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: new URL('.', window.location.href).href } }); if (e) throw e; setMessage('Your sign-in link is on its way. Open the email to come home.'); setSent(true) }
    catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return <div className="auth-page"><div className="auth-story"><Brand /><div><p className="eyebrow">A PRIVATE PLACE FOR TWO</p><h1>All the little things.<br /><em>All in one place.</em></h1><p>A song that sounds like them. A photo of your day.<br />A little love, left for later.</p></div><span className="auth-footer"><HeartHandshake /> A little closer, wherever you are.</span></div><div className="auth-form-wrap"><div className="auth-form"><span className="form-kicker"><KeyRound /></span><h2>Come on in.</h2><p>Sign in with your email, then create a nook or join your partner with their invitation code.</p>{configured ? <form onSubmit={submit}><label>Email address<input type="email" autoComplete="email" required value={email} onChange={e => { setEmail(e.target.value); setSent(false) }} placeholder="you@example.com" /></label><button className="button full" disabled={busy || sent}>{busy ? <LoaderCircle className="spin" /> : <Mail />}{sent ? 'Check your inbox' : 'Email me a sign-in link'}</button>{sent && <button type="button" className="text-button" onClick={() => { setSent(false); setMessage('') }}>Use another email or try again</button>}<small>Your personal sign-in link and your shared partner code are separate.</small></form> : <div className="setup-message"><Sparkles /><strong>Our Nook is getting ready.</strong><p>Sign-in will open once setup is complete.</p></div>}{message && <p className="form-message" role="status">{message}</p>}{error && <p className="form-error" role="alert">{error}</p>}</div></div></div>
}

function ProfileForm({ profile, act, busy, after }: { profile: Profile; act: Action; busy: boolean; after?: () => void }) {
  const [form, setForm] = useState({ ...profile, timezone: profile.display_name === 'You' ? deviceTimezone() : profile.timezone })
  const zones = Array.from(new Set([deviceTimezone(), 'UTC', ...Intl.supportedValuesOf('timeZone')]))
  function field(name: keyof Profile, value: string) { setForm(previous => ({ ...previous, [name]: value })) }
  async function save(e: FormEvent) { e.preventDefault(); if (!validTimezone(form.timezone)) return; const ok = await act(async () => { const { error } = await db().from('nook_profiles').update({ display_name: form.display_name.trim(), avatar: form.avatar, city: form.city.trim(), country: form.country.trim(), timezone: form.timezone, time_format: form.time_format, theme: form.theme, status: form.status.trim() }).eq('id', profile.id); if (error) throw error }, 'Your corner is updated.'); if (ok) after?.() }
  return <form className="stack-form" onSubmit={save}>
    <fieldset className="avatar-picker"><legend>Your little avatar</legend>{['🌷','🌙','🐻','🐱','🦊','🐼','🌻','☕','🌈','🪻'].map(avatar => <button type="button" key={avatar} aria-label={`Choose ${avatar}`} aria-pressed={form.avatar === avatar} onClick={() => field('avatar', avatar)}>{avatar}</button>)}</fieldset>
    <label>Name or nickname<input required maxLength={60} value={form.display_name} onChange={e => field('display_name', e.target.value)} autoComplete="nickname" /></label>
    <div className="form-columns"><label>City <span>(optional)</span><input maxLength={80} value={form.city} onChange={e => field('city', e.target.value)} autoComplete="address-level2" /></label><label>Country <span>(optional)</span><input maxLength={80} value={form.country} onChange={e => field('country', e.target.value)} autoComplete="country-name" /></label></div>
    <label>Time zone<input required list="timezones" value={form.timezone} onChange={e => field('timezone', e.target.value)} aria-invalid={!validTimezone(form.timezone)} /><datalist id="timezones">{zones.map(zone => <option key={zone} value={zone} />)}</datalist>{!validTimezone(form.timezone) && <small className="form-error">Choose a time zone from the list.</small>}</label>
    <div className="form-columns"><label>Clock<select value={form.time_format} onChange={e => field('time_format', e.target.value)}><option value="12">12-hour</option><option value="24">24-hour</option></select></label><label>Feel<select value={form.theme} onChange={e => field('theme', e.target.value)}><option value="rose">Rose & cream</option><option value="night">After dark</option></select></label></div>
    <label>A little status<input maxLength={100} placeholder="Could use a cuddle today" value={form.status} onChange={e => field('status', e.target.value)} /></label>
    <button className="button" disabled={busy || !validTimezone(form.timezone)}><Check />{after ? 'Save and continue' : 'Save my settings'}</button>
  </form>
}

function Onboarding({ profile, act, busy, joined, invite }: { profile: Profile; act: Action; busy: boolean; joined: () => void; invite: (code: string) => void }) {
  const [ready, setReady] = useState(profile.display_name !== 'You'); const [mode, setMode] = useState<'create' | 'join'>('create'); const [title, setTitle] = useState('Our little nook'); const [code, setCode] = useState('')
  async function submit(e: FormEvent) { e.preventDefault(); const ok = await act(async () => { if (mode === 'create') { await rpc('create_couple', { p_title: title.trim() }); const result = await rpc<{ code: string }>('issue_invite'); invite(result.code) } else await rpc('join_couple', { p_code: code }) }); if (ok) joined() }
  if (!ready) return <section className="panel onboarding-panel"><p className="eyebrow">FIRST, A LITTLE YOU</p><h1>Make yourself at home.</h1><ProfileForm profile={profile} act={act} busy={busy} after={() => setReady(true)} /></section>
  return <section className="panel onboarding-panel"><span className="form-kicker"><Users /></span><h1>A nook for two.</h1><p>Create your shared space, or enter the invitation code your partner gave you.</p><div className="segmented" aria-label="Create or join"><button aria-pressed={mode === 'create'} onClick={() => setMode('create')}>Create a nook</button><button aria-pressed={mode === 'join'} onClick={() => setMode('join')}>I have a code</button></div><form className="stack-form" onSubmit={submit}>{mode === 'create' ? <label>Name your space<input required maxLength={80} value={title} onChange={e => setTitle(e.target.value)} /></label> : <label>Partner invitation code<input className="code-input" required autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={30} value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" /><small>A code can be used once and expires after 24 hours.</small></label>}<button className="button full" disabled={busy}><KeyRound />{mode === 'create' ? 'Create our nook' : 'Join our nook'}</button></form></section>
}

function InviteCode({ code, dismiss }: { code: string; dismiss: () => void }) {
  const [copied, setCopied] = useState(false); const [copyError, setCopyError] = useState('')
  const formatted = code.match(/.{1,4}/g)?.join('-') || code
  async function copy() { try { await navigator.clipboard.writeText(formatted); setCopied(true) } catch { setCopyError('Select the code above to copy it.') } }
  return <section className="invite-code panel"><button className="icon-button dismiss" aria-label="Close invite code" onClick={dismiss}><X /></button><p className="eyebrow">JUST FOR YOUR PERSON</p><h2>Your partner’s invitation</h2><p>Share this code privately. It joins one account to this nook.</p><code>{formatted}</code><div className="inline-actions"><button className="button" onClick={copy}>{copied ? <Check /> : <Copy />}{copied ? 'Copied' : 'Copy invitation code'}</button><span className="muted">One use · valid for 24 hours</span></div>{copyError && <p role="status">{copyError}</p>}</section>
}

function PersonClock({ profile, now }: { profile: Profile; now: Date }) { return <div className="person-clock"><span className="avatar large">{profile.avatar}</span><h3>{profile.display_name}</h3><p>{[...new Set([profile.city,profile.country].filter(Boolean))].join(', ') || profile.timezone.replaceAll('_', ' ')}</p><div className="clock-time">{clock(profile, now)}</div><small>{localDay(profile, now)}</small>{profile.status && <span className="status-note">{profile.status}</span>}</div> }
function QuickNote({ nook, act, busy }: { nook: Nook; act: Action; busy: boolean }) {
  const [text, setText] = useState('')
  return <form onSubmit={async e => { e.preventDefault(); if (!text.trim()) return; if (await act(() => createPost(nook, 'note', text.trim()), 'A little note, left with love.')) setText('') }}><label className="sr-only" htmlFor="quick-note">Write a note</label><textarea id="quick-note" required maxLength={4000} placeholder="This made me think of you…" value={text} onChange={e => setText(e.target.value)} /><button className="button secondary" disabled={busy || !text.trim()}><Send /> Leave this here</button></form>
}
function PostCard({ post, nook, act, busy }: { post: Post; nook: Nook; act: Action; busy: boolean }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const author = nook.people.find(p => p.id === post.author_id)
  const music = post.link_url && safeMusicUrl(post.link_url)
  async function remove() { setDeleteError(''); const ok = await act(async () => { if (post.storage_path) { const { error } = await db().storage.from('nook-memories').remove([post.storage_path]); if (error) throw error } const { error } = await db().from('nook_posts').delete().eq('id',post.id); if (error) throw error }, 'Removed from your nook.', setDeleteError); if (ok) setConfirmDelete(false) }
  return <article className={`post-card ${post.kind}`}>
    {post.kind === 'photo' && (post.image_url ? <a href={post.image_url} target="_blank" rel="noreferrer" className="photo-link"><img src={post.image_url} alt={post.body || 'A shared memory'} loading="lazy" /></a> : <div className="photo-unavailable"><Image /><span>Photo unavailable. Refresh to try again.</span></div>)}
    {post.kind === 'song' && <div className="post-kind"><Music2 /><span>A little dedication</span></div>}
    {post.kind === 'hug' && <div className="hug-mark"><HeartHandshake /><p>{author?.display_name || 'Your partner'} left a hug.</p></div>}
    {post.kind === 'note' && <Mail className="note-mark" />}
    {post.body && <p className="post-body">{post.body}</p>}
    {music && <a className="music-link" href={music} target="_blank" rel="noopener noreferrer">Open music <ArrowRight /><small>{new URL(music).hostname.replace('www.','')}</small></a>}
    <footer><span className="post-author"><span>{author?.avatar || '♡'}</span>{author?.display_name || 'Your partner'}<small>{new Intl.DateTimeFormat(undefined,{ month:'short', day:'numeric', hour:'numeric', minute:'2-digit', timeZone:nook.profile.timezone }).format(new Date(post.created_at))}</small></span>{post.author_id === nook.profile.id && <button className="icon-button" aria-label="Delete this memory" onClick={() => setConfirmDelete(true)}><Trash2 /></button>}</footer>
    {confirmDelete && <Modal title="Remove this memory?" close={() => setConfirmDelete(false)} busy={busy}><p>This removes it from your shared nook.</p>{deleteError && <p className="form-error" role="alert">{deleteError}</p>}<div className="modal-actions"><button className="button secondary" disabled={busy} onClick={() => setConfirmDelete(false)}>Keep it</button><button className="button danger" disabled={busy} onClick={remove}>Remove</button></div></Modal>}
  </article>
}

function Modal({ title, children, close, busy }: { title: string; children: ReactNode; close: () => void; busy: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal(); return () => ref.current?.close() }, [])
  return <dialog ref={ref} className="modal" onCancel={e => { e.preventDefault(); if (!busy) close() }}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="Close" disabled={busy} onClick={close}><X /></button></div>{children}</dialog>
}
function Composer({ kind: initial, nook, act, busy, close }: { kind: 'note' | 'photo' | 'song'; nook: Nook; act: Action; busy: boolean; close: () => void }) {
  const [kind, setKind] = useState(initial); const [body, setBody] = useState(''); const [link, setLink] = useState(''); const [file, setFile] = useState<File>(); const [error, setError] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault(); setError('')
    const url = kind === 'song' ? safeMusicUrl(link) : null
    if (kind === 'song' && !url) { setError('Use an https link from Spotify, Apple Music, YouTube, SoundCloud, or Bandcamp.'); return }
    if (kind === 'photo' && !file) { setError('Choose a photo first.'); return }
    if (kind === 'note' && !body.trim()) { setError('Write a little something first.'); return }
    const ok = await act(() => createPost(nook,kind,body.trim(),url,kind === 'photo' ? file : undefined),'Saved to your nook.',setError)
    if (ok) close()
  }
  return <Modal title="Leave a little something" close={close} busy={busy}><div className="segmented">{(['note','photo','song'] as const).map(item => <button key={item} aria-pressed={kind === item} disabled={busy} onClick={() => { setKind(item); setError('') }}>{item === 'note' ? <Mail /> : item === 'photo' ? <Camera /> : <Music2 />}{item[0].toUpperCase()+item.slice(1)}</button>)}</div><form className="stack-form" onSubmit={submit}>{kind === 'photo' && <label className="upload-field"><Camera /><strong>{file?.name || 'Choose a photo'}</strong><span>JPG, PNG, or WebP · up to 10 MB</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => setFile(e.target.files?.[0])} required /></label>}{kind === 'song' && <label>Song or playlist link<input required type="url" value={link} onChange={e => setLink(e.target.value)} placeholder="https://open.spotify.com/…" /></label>}<label>{kind === 'song' ? 'Your dedication' : kind === 'photo' ? 'The story behind it (optional)' : 'Your note'}<textarea rows={5} maxLength={4000} required={kind === 'note'} value={body} onChange={e => setBody(e.target.value)} placeholder={kind === 'song' ? 'For your ride home ♡' : 'A little piece of my day…'} /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="button full" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <Heart />}Save to our nook</button></form></Modal>
}

function GamePanel({ nook, act, busy }: { nook: Nook; act: Action; busy: boolean }) {
  const game = nook.game; const partner = nook.people.find(p => p.id !== nook.profile.id)
  const myTurn = game?.turn_user === nook.profile.id && game.status === 'playing'
  const winner = nook.people.find(p => p.id === game?.winner)
  return <div className="game-layout"><section className="panel game-panel"><p className="eyebrow">TIC-TAC-TOGETHER</p><h2>A tiny game. A shared moment.</h2><p>{!partner ? 'Invite your person to play.' : !game ? 'Pick a square, leave a turn for later.' : game.status === 'draw' ? 'A perfect tie. Very us.' : game.status === 'won' ? `${winner?.display_name || 'Your partner'} takes this one!` : myTurn ? 'Your turn. Make it a good one.' : `Waiting for ${partner.display_name}’s next move.`}</p><div className="game-board" aria-label="Tic tac toe board">{(game?.board || Array(9).fill('')).map((cell, index) => <button key={index} className={`game-square ${cell === 'X' ? 'cross' : 'circle'}`} aria-label={`Square ${index+1}${cell ? `: ${cell}` : ': empty'}`} disabled={!myTurn || Boolean(cell) || busy} onClick={() => void act(() => rpc('play_move',{ p_game_id: game?.id, p_cell: index }))}>{cell === 'X' ? <X /> : cell === 'O' ? <Heart /> : <span />}</button>)}</div>{partner && (!game || game.status !== 'playing') && <button className="button" disabled={busy} onClick={() => void act(() => rpc('start_game'))}><Gamepad2 />{game ? 'One more round?' : 'Start our first game'}</button>}{game && <div className="game-players"><span><X />{nook.people.find(p => p.id === game.player_x)?.display_name}</span><span><Heart />{nook.people.find(p => p.id === game.player_o)?.display_name}</span></div>}</section><aside className="game-aside"><span className="empty-icon"><HeartHandshake /></span><h2>At your own pace.</h2><p>Your moves stay here. Come back when you have a minute together—or leave your turn for them to find.</p><p>Three in a row wins. A heart counts as O.</p></aside></div>
}

function CoupleForm({ couple, act, busy }: { couple: Couple; act: Action; busy: boolean }) {
  const [title, setTitle] = useState(couple.title); const [anniversary, setAnniversary] = useState(couple.anniversary || ''); const [visit, setVisit] = useState(couple.next_visit || '')
  return <form className="stack-form" onSubmit={async e => { e.preventDefault(); await act(async () => { const { error } = await db().from('nook_couples').update({ title:title.trim(), anniversary:anniversary || null, next_visit:visit || null }).eq('id',couple.id); if (error) throw error },'Your shared space is updated.') }}><label>Name of your nook<input required maxLength={80} value={title} onChange={e => setTitle(e.target.value)} /></label><label>Anniversary <span>(optional)</span><input type="date" value={anniversary} onChange={e => setAnniversary(e.target.value)} /></label><label>Next visit <span>(optional)</span><input type="date" value={visit} onChange={e => setVisit(e.target.value)} /></label><button className="button" disabled={busy}><Check />Save shared settings</button></form>
}
function TelegramConnect({ act, busy }: { act: Action; busy: boolean }) {
  const [link, setLink] = useState(''); const [disconnected, setDisconnected] = useState(false)
  return <><p>Connect your Telegram account to save photos, notes, and music links straight into your nook.</p>{botUsername ? <><button className="button secondary" disabled={busy} onClick={() => void act(async () => { const data = await rpc<{ token:string }>('telegram_token'); setLink(`https://t.me/${botUsername}?start=${data.token}`); setDisconnected(false) })}><Link />Create connection link</button>{link && <a className="button telegram-open" href={link} target="_blank" rel="noopener noreferrer">Open Telegram <ArrowRight /></a>}<button className="text-button" disabled={busy} onClick={() => void act(async () => { await rpc('disconnect_telegram'); setLink(''); setDisconnected(true) }, 'Telegram disconnected.')}>Disconnect Telegram</button>{disconnected && <small>Your Telegram connection has been removed.</small>}</> : <p className="muted">Telegram sharing will be available after the bot is connected.</p>}</>
}
