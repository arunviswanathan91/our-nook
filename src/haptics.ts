import { Capacitor, registerPlugin } from '@capacitor/core'
import { defaultHapticPreferences, parseHapticPreferences, patternFor, type FeedbackKind, type HapticPreferences } from './haptic-patterns'

interface NativeHaptics {
  capabilities(): Promise<{ supported: boolean }>
  play(options: { pattern: number[]; intensity: number; sharpness: number }): Promise<{ played: boolean }>
  stop(): Promise<void>
}
const native = registerPlugin<NativeHaptics>('NookHaptics')
export type HapticSupport = 'checking' | 'native' | 'browser' | 'unavailable'
export type FeedbackSource = 'interface' | 'sent' | 'received' | 'preview' | 'hold'
export type FeedbackResult = 'requested' | 'muted' | 'off' | 'hidden' | 'unsupported' | 'blocked' | 'busy'
let preferences = defaultHapticPreferences()
let userId = ''
let enabled = false
let quiet = false
let support: HapticSupport = 'checking'
let supportPromise: Promise<HapticSupport> | undefined
let generation = 0
let lastPulse = 0
let protectedUntil = 0
const listeners = new Set<() => void>()
const notify = () => listeners.forEach(listener => listener())
const storageKey = () => `our-nook:haptics:v1:${userId}`
export function getHapticPreferences() { return preferences }
export function getHapticSupport() { return support }
export function subscribeHaptics(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export const isNativeApp = () => Capacitor.isNativePlatform()
export function checkHapticSupport(): Promise<HapticSupport> {
  if (!supportPromise) supportPromise = (async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        support = Capacitor.isPluginAvailable('NookHaptics') && (await native.capabilities()).supported ? 'native' : 'unavailable'
      } else support = typeof navigator.vibrate === 'function' ? 'browser' : 'unavailable'
    } catch { support = 'unavailable' }
    notify()
    return support
  })()
  return supportPromise
}
export function configureFeedback(profile: { id: string; haptics?: boolean; quiet_mode?: boolean }) {
  if (userId !== profile.id) {
    stopFeedback()
    userId = profile.id
    try { preferences = parseHapticPreferences(JSON.parse(localStorage.getItem(storageKey()) || 'null')) }
    catch { preferences = defaultHapticPreferences() }
    notify()
  }
  enabled = profile.haptics !== false
  quiet = profile.quiet_mode === true
  if (!enabled || quiet) stopFeedback()
  void checkHapticSupport()
}
export function saveHapticPreferences(next: HapticPreferences) {
  stopFeedback()
  preferences = parseHapticPreferences(next)
  notify()
  try { localStorage.setItem(storageKey(), JSON.stringify(preferences)); return true }
  catch { return false }
}
export function stopFeedback() {
  generation++
  protectedUntil = 0
  if (Capacitor.isNativePlatform()) {
    if (Capacitor.isPluginAvailable('NookHaptics')) void native.stop().catch(() => {})
  } else { try { navigator.vibrate?.(0) } catch { /* Optional hardware. */ } }
}
export async function feedback(kind: FeedbackKind = 'tap', source: FeedbackSource = 'interface'): Promise<FeedbackResult> {
  if (!enabled || quiet) return 'muted'
  if (document.hidden) return 'hidden'
  const local = source === 'interface' || source === 'sent' || source === 'hold'
  if (local && !preferences.buttonFeedback) return 'off'
  const pattern = source === 'interface' && kind === 'tap'
    ? { timing: [9], intensity: .25, sharpness: .45 }
    : patternFor(kind, preferences)
  if (!pattern) return 'off'
  // A button animation / send acknowledgement must not cut off a partner's
  // longer hug or an explicit preview while it is still playing.
  if (local && (Date.now() < protectedUntil || Date.now() - lastPulse < 90)) return 'busy'
  const token = ++generation
  const available = await checkHapticSupport()
  if (token !== generation || document.hidden || !enabled || quiet) return 'hidden'
  if (available === 'unavailable') return 'unsupported'
  lastPulse = Date.now()
  if (!local) protectedUntil = lastPulse + pattern.timing.reduce((sum, ms) => sum + ms, 0)
  try {
    if (available === 'native') {
      const result = await native.play({ pattern: pattern.timing, intensity: pattern.intensity, sharpness: pattern.sharpness })
      return result.played ? 'requested' : 'blocked'
    }
    return navigator.vibrate(pattern.timing) ? 'requested' : 'blocked'
  } catch { return 'blocked' }
}
export function installFeedback() {
  void checkHapticSupport()
  const click = (event: MouseEvent) => {
    const target = (event.target as HTMLElement)?.closest<HTMLElement>('button,a,summary,input[type=checkbox]')
    if (!target || target.hasAttribute('disabled') || target.dataset.haptic === 'none' || target.closest('[data-haptic="none"]')) return
    void feedback('tap', 'interface')
  }
  const visibility = () => { if (document.hidden) stopFeedback() }
  const storage = (event: StorageEvent) => {
    if (event.key !== storageKey()) return
    try { preferences = parseHapticPreferences(JSON.parse(event.newValue || 'null')) } catch { preferences = defaultHapticPreferences() }
    stopFeedback(); notify()
  }
  document.addEventListener('click', click)
  document.addEventListener('visibilitychange', visibility)
  window.addEventListener('storage', storage)
  return () => {
    document.removeEventListener('click', click); document.removeEventListener('visibilitychange', visibility)
    window.removeEventListener('storage', storage); stopFeedback(); enabled = false
  }
}
