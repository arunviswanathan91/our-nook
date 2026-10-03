import { useState, useSyncExternalStore } from 'react'
import { Heart, Play, RotateCcw, Smartphone, Square, Vibrate } from 'lucide-react'
import type { Profile } from './lib'
import { defaultHapticPreferences, gestureNames, hapticPatterns, signalKinds, type HapticPreferences, type PatternChoice, type SignalKind } from './haptic-patterns'
import { feedback, getHapticPreferences, getHapticSupport, isNativeApp, saveHapticPreferences, stopFeedback, subscribeHaptics } from './haptics'

export function TouchSupport({ settings }: { settings?: () => void }) {
  const support = useSyncExternalStore(subscribeHaptics, getHapticSupport)
  const text = support === 'checking' ? 'Checking this phone’s vibration support…'
    : support === 'native' ? 'Touch vibrations are ready while Our Nook is open.'
    : support === 'browser' ? 'Vibrations work on supported phones while this app is open.'
    : isNativeApp() ? 'This device has no supported haptic hardware. Your touches still reach your person.'
    : 'This browser can send touches, but cannot vibrate. On iPhone, vibrations need the native app; a Home Screen shortcut cannot enable them.'
  return <div className={`touch-support ${support === 'unavailable' ? 'visual-only' : ''}`}><Smartphone aria-hidden="true"/><p>{text} {settings && <button className="text-button" data-haptic="none" onClick={settings}>Vibration options</button>}</p></div>
}

export function HapticSettings({ profile }: { profile: Profile }) {
  const preferences = useSyncExternalStore(subscribeHaptics, getHapticPreferences)
  const support = useSyncExternalStore(subscribeHaptics, getHapticSupport)
  const [message, setMessage] = useState('')
  const muted = profile.haptics === false || profile.quiet_mode === true
  function save(next: HapticPreferences) {
    const saved = saveHapticPreferences(next)
    setMessage(saved ? 'Saved for your account on this device.' : 'Applied for now. This browser could not save your choices for the next visit.')
  }
  async function preview(kind: SignalKind) {
    const result = await feedback(kind, 'preview')
    setMessage(result === 'requested' ? `${gestureNames[kind]} pattern requested on this phone only. Nothing was sent to your partner.`
      : result === 'muted' ? 'Turn on Gentle haptics and turn off Quiet mode in Your corner, then save those settings.'
      : result === 'off' ? 'Choose a pattern first; this gesture is set to off.'
      : result === 'unsupported' ? 'This browser cannot vibrate. An iPhone needs the native app.'
      : 'Vibration was not available. Keep the app open and check your phone’s vibration settings.')
  }
  return <section className="panel haptic-settings" data-haptic="none" aria-labelledby="haptic-title">
    <div className="haptic-title"><span className="mini-wax"><Vibrate/></span><div><p className="eyebrow">A FEELING, JUST FOR YOU</p><h2 id="haptic-title">Touch & vibration</h2></div></div>
    <p className="muted">Choose how each of your partner’s gestures feels on your phone. These choices belong to your account on this device.</p>
    <TouchSupport/>
    {muted && <p className="haptic-muted" role="status">Vibrations are paused. Enable Gentle haptics and disable Quiet mode in Your corner, then save your settings.</p>}
    <div className="form-columns haptic-controls">
      <label>Pulse length<select aria-label="Pulse length" value={preferences.pulseLength} onChange={e => save({ ...preferences, pulseLength: e.target.value as HapticPreferences['pulseLength'] })}><option value="short">Shorter</option><option value="regular">Regular</option><option value="long">Longer</option></select></label>
      {support === 'native' && <label>Vibration strength<select aria-label="Vibration strength" value={preferences.strength} onChange={e => save({ ...preferences, strength: e.target.value as HapticPreferences['strength'] })}><option value="gentle">Gentle</option><option value="balanced">Balanced</option><option value="strong">More noticeable</option></select></label>}
    </div>
    <label className="checkbox-label"><input type="checkbox" checked={preferences.buttonFeedback} onChange={e => save({ ...preferences, buttonFeedback: e.target.checked })}/>Vibrate when I tap buttons or send a touch</label>
    <p className="footnote">Turn this off to feel only incoming gestures. Quiet mode and Gentle haptics in Your corner apply to all vibrations.</p>
    <div className="haptic-pattern-list">{signalKinds.map(kind => {
      const choice = preferences.gestures[kind]
      const pattern = choice === 'off' ? null : hapticPatterns[choice]
      return <div className="haptic-pattern-row" key={kind}>
        <div className="haptic-pattern-name"><Heart aria-hidden="true"/><strong>{gestureNames[kind]}</strong></div>
        <label className="haptic-pattern-choice"><span className="sr-only">{gestureNames[kind]} vibration pattern</span><select value={choice} onChange={e => save({ ...preferences, gestures: { ...preferences.gestures, [kind]: e.target.value as PatternChoice } })}><option value="off">Off · visual only</option>{Object.entries(hapticPatterns).map(([id, item]) => <option key={id} value={id}>{item.name}</option>)}</select></label>
        <button className="icon-button haptic-preview" disabled={!pattern || muted || support === 'unavailable' || support === 'checking'} aria-label={`Preview ${gestureNames[kind]} vibration`} onClick={() => void preview(kind)}><Play/></button>
        <div className="haptic-pattern-caption"><span className="haptic-rhythm" aria-hidden="true">{pattern ? pattern.timing.map((ms, index) => <i key={index} className={index % 2 ? 'pause' : 'pulse'} style={{ width: Math.max(3, ms / 10) }}/>) : <span>—</span>}</span><small>{pattern?.description || 'You will still see the gesture.'}</small></div>
      </div>
    })}</div>
    <div className="haptic-actions"><button className="button secondary" onClick={() => { stopFeedback(); setMessage('Vibration stopped on this phone.') }}><Square/>Stop preview</button><button className="text-button" onClick={() => save(defaultHapticPreferences())}><RotateCcw/>Restore defaults</button></div>
    <p className="haptic-feedback" role="status">{message}</p>
    <p className="footnote">Preview stays on your phone. Sending a gesture uses your partner’s choices. Custom touch vibrations need the app open; locked-screen alerts are not enabled in this version.</p>
  </section>
}
