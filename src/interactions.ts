import type { Profile } from './lib'
export type { SignalKind } from './haptic-patterns'
export { configureFeedback, feedback, installFeedback, stopFeedback } from './haptics'
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
