import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultHapticPreferences, hapticPatterns, parseHapticPreferences, patternFor, signalKinds } from '../src/haptic-patterns.ts'

test('every gesture has a distinct, short native-compatible default rhythm at each pulse length', () => {
  for (const pulseLength of ['short', 'regular', 'long']) {
    const preferences = { ...defaultHapticPreferences(), pulseLength }
    const rhythms = signalKinds.map(kind => patternFor(kind, preferences).timing)
    assert.equal(new Set(rhythms.map(p => JSON.stringify(p))).size, signalKinds.length)
    for (const timing of rhythms) {
      assert.equal(timing.length % 2, 1)
      assert.ok(timing.length <= 31)
      assert.ok(timing.every(ms => Number.isInteger(ms) && ms > 0 && ms <= 1000))
      assert.ok(timing.reduce((sum, ms) => sum + ms, 0) <= 5000)
    }
  }
})

test('malformed and old device preferences cannot introduce unbounded patterns or invalid native strength', () => {
  for (const input of [null, false, [], 'bad', { version: 2, strength: 'strong' }]) assert.deepEqual(parseHapticPreferences(input), defaultHapticPreferences())
  const clean = parseHapticPreferences({ version: 1, strength: 200, pulseLength: 'forever', buttonFeedback: 'false', gestures: { hug: [999999], tap: '__proto__', kiss: 'off', wave: 'heartbeat' } })
  assert.equal(clean.strength, 'gentle')
  assert.equal(clean.pulseLength, 'regular')
  assert.equal(clean.buttonFeedback, true)
  assert.equal(clean.gestures.hug, 'embrace')
  assert.equal(clean.gestures.tap, 'tiny')
  assert.equal(patternFor('kiss', clean), null)
  assert.deepEqual(patternFor('wave', clean).timing, hapticPatterns.heartbeat.timing)
})
