import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowRight, Check, Copy, Gamepad2, Heart, HeartHandshake, KeyRound, Link, Users, X } from 'lucide-react'
import { botUsername, db, deviceTimezone, rpc, validTimezone, type Couple, type Nook, type Profile } from './lib'
export type Action = (work: () => Promise<unknown>, message?: string, onError?: (message: string) => void) => Promise<boolean>

export function Notice({ notice, close }: { notice: { text: string; error: boolean }; close: () => void }) { return <div className={`notice ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}><span>{notice.text}</span><button className="icon-button" aria-label="Dismiss message" onClick={close}><X /></button></div> }

export function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) { return <div className="empty-state"><span className="empty-icon">{icon}</span><h2>{title}</h2><p>{text}</p>{action}</div> }


export function ProfileForm({ profile, act, busy, after }: { profile: Profile; act: Action; busy: boolean; after?: () => void }) {
  const [form, setForm] = useState({ ...profile, timezone: profile.display_name === 'You' ? deviceTimezone() : profile.timezone })
  const zones = Array.from(new Set([deviceTimezone(), 'UTC', ...Intl.supportedValuesOf('timeZone')]))
  function field(name: keyof Profile, value: string | boolean) { setForm(previous => ({ ...previous, [name]: value })) }
  async function save(e: FormEvent) { e.preventDefault(); if (!validTimezone(form.timezone)) return; const ok = await act(async () => { const { error } = await db().from('nook_profiles').update({ display_name: form.display_name.trim(), avatar: form.avatar, city: form.city.trim(), country: form.country.trim(), timezone: form.timezone, time_format: form.time_format, theme: form.theme, status: form.status.trim(), pronouns: (form.pronouns || '').trim(), haptics: form.haptics !== false, quiet_mode: Boolean(form.quiet_mode) }).eq('id', profile.id); if (error) throw error }, 'Your corner is updated.'); if (ok) after?.() }
  return <form className="stack-form" onSubmit={save}>
    <fieldset className="avatar-picker"><legend>Your little avatar</legend>{['🌷','🌙','🐻','🐱','🦊','🐼','🌻','☕','🌈','🪻'].map(avatar => <button type="button" key={avatar} aria-label={`Choose ${avatar}`} aria-pressed={form.avatar === avatar} onClick={() => field('avatar', avatar)}>{avatar}</button>)}</fieldset>
    <label>Name or nickname<input required maxLength={60} value={form.display_name} onChange={e => field('display_name', e.target.value)} autoComplete="nickname" /></label>
    <label>Pronouns <span>(optional)</span><input maxLength={40} value={form.pronouns || ''} onChange={e => field('pronouns', e.target.value)} placeholder="Whatever feels like you" /></label>
    <div className="form-columns"><label>City <span>(optional)</span><input maxLength={80} value={form.city} onChange={e => field('city', e.target.value)} autoComplete="address-level2" /></label><label>Country <span>(optional)</span><input maxLength={80} value={form.country} onChange={e => field('country', e.target.value)} autoComplete="country-name" /></label></div>
    <label>Time zone<input required list="timezones" value={form.timezone} onChange={e => field('timezone', e.target.value)} aria-invalid={!validTimezone(form.timezone)} /><datalist id="timezones">{zones.map(zone => <option key={zone} value={zone} />)}</datalist>{!validTimezone(form.timezone) && <small className="form-error">Choose a time zone from the list.</small>}</label>
    <div className="form-columns"><label>Clock<select value={form.time_format} onChange={e => field('time_format', e.target.value)}><option value="12">12-hour</option><option value="24">24-hour</option></select></label><label>Feel<select value={form.theme} onChange={e => field('theme', e.target.value)}><option value="rose">Rose & cream</option><option value="night">After dark</option></select></label></div>
    <label>A little status<input maxLength={100} placeholder="Could use a cuddle today" value={form.status} onChange={e => field('status', e.target.value)} /></label>
    <label className="checkbox-label"><input type="checkbox" checked={form.haptics !== false} onChange={e => field('haptics', e.target.checked)} />Gentle haptics</label><small>A little vibration on supported phones. Every interaction also has a visual response.</small>
    <label className="checkbox-label"><input type="checkbox" checked={Boolean(form.quiet_mode)} onChange={e => field('quiet_mode', e.target.checked)} />Quiet mode</label><small>Keep the little hellos silent and show your person that you’re resting.</small>
    <button className="button" disabled={busy || !validTimezone(form.timezone)}><Check />{after ? 'Save and continue' : 'Save my settings'}</button>
  </form>
}


export function Onboarding({ profile, act, busy, joined, invite }: { profile: Profile; act: Action; busy: boolean; joined: () => void; invite: (code: string) => void }) {
  const [ready, setReady] = useState(profile.display_name !== 'You'); const [mode, setMode] = useState<'create' | 'join'>('create'); const [title, setTitle] = useState('Our little nook'); const [code, setCode] = useState('')
  async function submit(e: FormEvent) { e.preventDefault(); const ok = await act(async () => { if (mode === 'create') { await rpc('create_couple', { p_title: title.trim() }); const result = await rpc<{ code: string }>('issue_invite'); invite(result.code) } else await rpc('join_couple', { p_code: code }) }); if (ok) joined() }
  if (!ready) return <section className="panel onboarding-panel"><p className="eyebrow">FIRST, A LITTLE YOU</p><h1>Make yourself at home.</h1><ProfileForm profile={profile} act={act} busy={busy} after={() => setReady(true)} /></section>
  return <section className="panel onboarding-panel"><span className="form-kicker"><Users /></span><h1>A nook for two.</h1><p>Create your shared space, or enter the invitation code your partner gave you.</p><div className="segmented" aria-label="Create or join"><button aria-pressed={mode === 'create'} onClick={() => setMode('create')}>Create a nook</button><button aria-pressed={mode === 'join'} onClick={() => setMode('join')}>I have a code</button></div><form className="stack-form" onSubmit={submit}>{mode === 'create' ? <label>Name your space<input required maxLength={80} value={title} onChange={e => setTitle(e.target.value)} /></label> : <label>Partner invitation code<input className="code-input" required autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={30} value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" /><small>A code can be used once and expires after 24 hours.</small></label>}<button className="button full" disabled={busy}><KeyRound />{mode === 'create' ? 'Create our nook' : 'Join our nook'}</button></form></section>
}


export function InviteCode({ code, dismiss }: { code: string; dismiss: () => void }) {
  const [copied, setCopied] = useState(false); const [copyError, setCopyError] = useState('')
  const formatted = code.match(/.{1,4}/g)?.join('-') || code
  async function copy() { try { await navigator.clipboard.writeText(formatted); setCopied(true) } catch { setCopyError('Select the code above to copy it.') } }
  return <section className="invite-code panel"><button className="icon-button dismiss" aria-label="Close invite code" onClick={dismiss}><X /></button><p className="eyebrow">JUST FOR YOUR PERSON</p><h2>Your partner’s invitation</h2><p>Share this code privately. It joins one account to this nook.</p><code>{formatted}</code><div className="inline-actions"><button className="button" onClick={copy}>{copied ? <Check /> : <Copy />}{copied ? 'Copied' : 'Copy invitation code'}</button><span className="muted">One use · valid for 24 hours</span></div>{copyError && <p role="status">{copyError}</p>}</section>
}


export function Modal({ title, children, close, busy }: { title: string; children: ReactNode; close: () => void; busy: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal(); return () => ref.current?.close() }, [])
  return <dialog ref={ref} className="modal" onCancel={e => { e.preventDefault(); if (!busy) close() }}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="Close" disabled={busy} onClick={close}><X /></button></div>{children}</dialog>
}

export function GamePanel({ nook, act, busy }: { nook: Nook; act: Action; busy: boolean }) {
  const game = nook.game; const partner = nook.people.find(p => p.id !== nook.profile.id)
  const myTurn = game?.turn_user === nook.profile.id && game.status === 'playing'
  const winner = nook.people.find(p => p.id === game?.winner)
  return <div className="game-layout"><section className="panel game-panel"><p className="eyebrow">TIC-TAC-TOGETHER</p><h2>A tiny game. A shared moment.</h2><p>{!partner ? 'Invite your person to play.' : !game ? 'Pick a square, leave a turn for later.' : game.status === 'draw' ? 'A perfect tie. Very us.' : game.status === 'won' ? `${winner?.display_name || 'Your partner'} takes this one!` : myTurn ? 'Your turn. Make it a good one.' : `Waiting for ${partner.display_name}’s next move.`}</p><div className="game-board" aria-label="Tic tac toe board">{(game?.board || Array(9).fill('')).map((cell, index) => <button key={index} className={`game-square ${cell === 'X' ? 'cross' : 'circle'}`} aria-label={`Square ${index+1}${cell ? `: ${cell}` : ': empty'}`} disabled={!myTurn || Boolean(cell) || busy} onClick={() => void act(() => rpc('play_move',{ p_game_id: game?.id, p_cell: index }))}>{cell === 'X' ? <X /> : cell === 'O' ? <Heart /> : <span />}</button>)}</div>{partner && (!game || game.status !== 'playing') && <button className="button" disabled={busy} onClick={() => void act(() => rpc('start_game'))}><Gamepad2 />{game ? 'One more round?' : 'Start our first game'}</button>}{game && <div className="game-players"><span><X />{nook.people.find(p => p.id === game.player_x)?.display_name}</span><span><Heart />{nook.people.find(p => p.id === game.player_o)?.display_name}</span></div>}</section><aside className="game-aside"><span className="empty-icon"><HeartHandshake /></span><h2>At your own pace.</h2><p>Your moves stay here. Come back when you have a minute together—or leave your turn for them to find.</p><p>Three in a row wins. A heart counts as O.</p></aside></div>
}


export function CoupleForm({ couple, act, busy }: { couple: Couple; act: Action; busy: boolean }) {
  const [title, setTitle] = useState(couple.title); const [anniversary, setAnniversary] = useState(couple.anniversary || ''); const [visit, setVisit] = useState(couple.next_visit || '')
  const [timezone,setTimezone] = useState(couple.ritual_timezone || 'UTC')
  return <form className="stack-form" onSubmit={async e => { e.preventDefault(); if(!validTimezone(timezone))return; await act(async () => { const { error } = await db().from('nook_couples').update({ title:title.trim(), anniversary:anniversary || null, next_visit:visit || null, ritual_timezone:timezone }).eq('id',couple.id); if (error) throw error },'Your shared space is updated.') }}>
    <label>Name of your nook<input required maxLength={80} value={title} onChange={e => setTitle(e.target.value)} /></label>
    <label>Anniversary <span>(optional)</span><input type="date" value={anniversary} onChange={e => setAnniversary(e.target.value)} /></label>
    <label>Next visit <span>(optional)</span><input type="date" value={visit} onChange={e => setVisit(e.target.value)} /></label>
    <label>Our shared day<input required list="timezones" value={timezone} onChange={e=>setTimezone(e.target.value)} aria-invalid={!validTimezone(timezone)}/><small>The time zone for your daily question, song swap, and plant watering. Your own clocks keep your own time zones.</small>{!validTimezone(timezone)&&<small className="form-error">Choose a valid time zone.</small>}</label>
    <button className="button" disabled={busy || !validTimezone(timezone)}><Check />Save shared settings</button>
  </form>
}

export function TelegramConnect({ act, busy }: { act: Action; busy: boolean }) {
  const [link, setLink] = useState(''); const [disconnected, setDisconnected] = useState(false)
  return <><p>Connect your Telegram account to save photos, notes, and music links straight into your nook.</p>{botUsername ? <><button className="button secondary" disabled={busy} onClick={() => void act(async () => { const data = await rpc<{ token:string }>('telegram_token'); setLink(`https://t.me/${botUsername}?start=${data.token}`); setDisconnected(false) })}><Link />Create connection link</button>{link && <a className="button telegram-open" href={link} target="_blank" rel="noopener noreferrer">Open Telegram <ArrowRight /></a>}<button className="text-button" disabled={busy} onClick={() => void act(async () => { await rpc('disconnect_telegram'); setLink(''); setDisconnected(true) }, 'Telegram disconnected.')}>Disconnect Telegram</button>{disconnected && <small>Your Telegram connection has been removed.</small>}</> : <p className="muted">Telegram sharing will be available after the bot is connected.</p>}</>
}
