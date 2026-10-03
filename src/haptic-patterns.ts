export const signalKinds = ['touch', 'tap', 'warmth', 'wave', 'kiss', 'clink', 'glimmer', 'hug'] as const
export type SignalKind = typeof signalKinds[number]
export type FeedbackKind = SignalKind | 'success' | 'error'
export const gestureNames: Record<SignalKind, string> = {
  touch: 'Shared touch', tap: 'Tiny tap', warmth: 'Warmth', wave: 'Wave',
  kiss: 'Kiss', clink: 'Mug clink', glimmer: 'Glimmer', hug: 'Hug',
}
// Alternating pulse / pause lengths, in milliseconds. The same bounded rhythm
// drives Android's Vibration API and iPhone's native Core Haptics engine.
export const hapticPatterns = {
  heartbeat: { name: 'Heartbeat', description: 'A soft beat, then a fuller beat.', timing: [60, 100, 110], sharpness: .3 },
  tiny: { name: 'Tiny tap', description: 'One short hello.', timing: [35], sharpness: .7 },
  warmth: { name: 'Warm waves', description: 'Two slow, warm pulses.', timing: [150, 90, 190], sharpness: .15 },
  wave: { name: 'Little wave', description: 'Three pulses that grow longer.', timing: [35, 100, 65, 100, 100], sharpness: .4 },
  kiss: { name: 'Double kiss', description: 'Two quick little kisses.', timing: [35, 70, 35], sharpness: .5 },
  clink: { name: 'Clink, clink', description: 'Two crisp taps, a moment apart.', timing: [22, 170, 22], sharpness: 1 },
  sparkle: { name: 'Twinkle', description: 'Four tiny sparkling pulses.', timing: [15, 50, 15, 50, 15, 50, 40], sharpness: .85 },
  embrace: { name: 'Long hug', description: 'Two longer, gentle squeezes.', timing: [260, 130, 340], sharpness: .1 },
} as const
export type PatternId = keyof typeof hapticPatterns
export type PatternChoice = PatternId | 'off'
export type HapticPreferences = {
  version: 1
  buttonFeedback: boolean
  strength: 'gentle' | 'balanced' | 'strong'
  pulseLength: 'short' | 'regular' | 'long'
  gestures: Record<SignalKind, PatternChoice>
}
export function defaultHapticPreferences(): HapticPreferences {
  return { version: 1, buttonFeedback: true, strength: 'gentle', pulseLength: 'regular', gestures: {
    touch: 'heartbeat', tap: 'tiny', warmth: 'warmth', wave: 'wave', kiss: 'kiss',
    clink: 'clink', glimmer: 'sparkle', hug: 'embrace',
  } }
}
export function isPattern(value: unknown): value is PatternChoice {
  return value === 'off' || typeof value === 'string' && Object.hasOwn(hapticPatterns, value)
}
// Preferences are device-local and untrusted on read (old versions, extensions,
// private browsing, and manually edited storage must not crash the dashboard).
export function parseHapticPreferences(value: unknown): HapticPreferences {
  const clean = defaultHapticPreferences()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return clean
  const input = value as Record<string, unknown>
  if (input.version !== 1) return clean
  if (typeof input.buttonFeedback === 'boolean') clean.buttonFeedback = input.buttonFeedback
  if (typeof input.strength === 'string' && ['gentle', 'balanced', 'strong'].includes(input.strength)) clean.strength = input.strength as HapticPreferences['strength']
  if (typeof input.pulseLength === 'string' && ['short', 'regular', 'long'].includes(input.pulseLength)) clean.pulseLength = input.pulseLength as HapticPreferences['pulseLength']
  if (input.gestures && typeof input.gestures === 'object') {
    for (const kind of signalKinds) {
      const selected = (input.gestures as Record<string, unknown>)[kind]
      if (isPattern(selected)) clean.gestures[kind] = selected
    }
  }
  return clean
}
export function patternFor(kind: FeedbackKind, preferences: HapticPreferences) {
  const choice = kind === 'success' ? 'heartbeat' : kind === 'error' ? 'wave' : preferences.gestures[kind]
  if (!choice || choice === 'off') return null
  const pattern = hapticPatterns[choice]
  const scale = { short: .7, regular: 1, long: 1.3 }[preferences.pulseLength]
  return { ...pattern, timing: pattern.timing.map((ms, index) => index % 2 ? ms : Math.round(ms * scale)),
    intensity: { gentle: .4, balanced: .65, strong: .9 }[preferences.strength] }
}
