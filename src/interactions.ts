import type { Profile } from './lib'

export type SignalKind = 'touch' | 'tap' | 'warmth' | 'wave' | 'kiss' | 'clink' | 'glimmer' | 'hug'
export const patterns: Record<SignalKind | 'success' | 'error', number[]> = {
  touch:[18,45,18],tap:[10],warmth:[25,50,35],wave:[8,45,12,45,18],kiss:[14,70,14],clink:[9,45,9],glimmer:[5,30,7,30,5],hug:[30,80,30],success:[10,40,20],error:[25,70,25],
}
let enabled = true
let quiet = false
let lastPulse = 0
export function configureFeedback(profile: Profile) { enabled = profile.haptics !== false; quiet = profile.quiet_mode === true }
export function feedback(kind: keyof typeof patterns = 'tap') {
  if (!enabled || quiet || document.hidden || typeof navigator.vibrate !== 'function' || Date.now()-lastPulse<90) return
  lastPulse=Date.now()
  try { navigator.vibrate(patterns[kind]) } catch { /* Visual feedback is always available. */ }
}
export function stopFeedback() { try { navigator.vibrate?.(0) } catch { /* Optional hardware. */ } }
export function installFeedback() {
  const click = (e: MouseEvent) => {
    const target = (e.target as HTMLElement)?.closest<HTMLElement>('button,a,summary,input[type=checkbox]')
    if (!target || target.hasAttribute('disabled') || target.dataset.haptic==='none') return
    feedback((target.dataset.haptic as keyof typeof patterns) || 'tap')
  }
  document.addEventListener('click',click)
  document.addEventListener('visibilitychange',stopFeedback)
  return () => { document.removeEventListener('click',click); document.removeEventListener('visibilitychange',stopFeedback); stopFeedback() }
}
export function localHour(profile: Profile, now = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB',{timeZone:profile.timezone,hour:'numeric',hourCycle:'h23'}).format(now))
}
export function dayKey(timezone: string, now = new Date()) { return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now) }
export function calendarDays(from: string, to: string) { return Math.round((Date.parse(to+'T12:00:00Z')-Date.parse(from+'T12:00:00Z'))/86400000) }
export function ago(date: string, now = Date.now()) {
  const minutes = Math.max(0,Math.floor((now-Date.parse(date))/60000))
  return minutes<1 ? 'just now' : minutes<60 ? `${minutes}m ago` : minutes<1440 ? `${Math.floor(minutes/60)}h ago` : `${Math.floor(minutes/1440)}d ago`
}
export function dateInZone(date: string, zone: string) { return new Intl.DateTimeFormat(undefined,{timeZone:zone,dateStyle:'medium',timeStyle:'short'}).format(new Date(date)) }
export function duration(seconds: number) { return `${Math.floor(seconds/60)}:${Math.floor(seconds%60).toString().padStart(2,'0')}` }
export function musicEmbed(url: string): string | null {
  try {
    const u = new URL(url)
    if(u.protocol!=='https:') return null
    if(u.hostname==='open.spotify.com') {
      const m=u.pathname.match(/^\/(?:intl-[a-z]+\/)?(track|album|playlist)\/([A-Za-z0-9]+)$/)
      return m ? `https://open.spotify.com/embed/${m[1]}/${m[2]}` : null
    }
    if(['www.youtube.com','youtube.com','youtu.be','music.youtube.com'].includes(u.hostname)) {
      const id=u.hostname==='youtu.be' ? u.pathname.slice(1) : u.searchParams.get('v')
      return id && /^[\w-]{11}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null
    }
    if(u.hostname==='music.apple.com') return `https://embed.music.apple.com${u.pathname}${u.search}`
  } catch { /* Keep the ordinary provider link available. */ }
  return null
}
