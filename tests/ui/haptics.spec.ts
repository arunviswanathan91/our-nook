import { test, expect, type Page } from '@playwright/test'
import { makeRitualStore, mockRituals } from './ritual-fixture'
import { mockApp, partnerId } from './fixture'

async function browserVibrations(page: Page, supported = true) {
  await page.addInitScript((supported) => {
    (window as any).pulses = []
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: supported ? (pattern: unknown) => { (window as any).pulses.push(pattern); return true } : undefined })
  }, supported)
}
async function nativeBridge(page: Page) {
  await page.addInitScript(() => {
    (window as any).nativeCalls = []
    ;(window as any).webkit = { messageHandlers: { bridge: {} } }
    ;(window as any).Capacitor = {
      PluginHeaders: [{ name: 'NookHaptics', methods: ['capabilities', 'play', 'stop'].map(name => ({ name, rtype: 'promise' })) }],
      nativePromise: async (plugin: string, method: string, options: unknown) => {
        (window as any).nativeCalls.push({ plugin, method, options })
        if (method === 'capabilities') return { supported: true }
        return { played: true }
      },
    }
  })
}

test('an iPhone browser sends real touches to Android, whose own choices control the received vibration', async ({ page, browser }) => {
  const store = makeRitualStore()
  await mockRituals(page, store); await browserVibrations(page)
  const context = await browser.newContext(); const iphone = await context.newPage()
  await mockRituals(iphone, store, true); await browserVibrations(iphone, false)
  await page.goto('/#settings'); await iphone.goto('http://127.0.0.1:4173/')
  await expect(iphone.getByText('This browser can send touches, but cannot vibrate.', { exact: false })).toBeVisible()
  await page.getByLabel('Vibrate when I tap buttons or send a touch').uncheck()
  await page.getByLabel('Kiss vibration pattern').selectOption('heartbeat')
  await page.reload()
  await expect(page.getByLabel('Kiss vibration pattern')).toHaveValue('heartbeat')
  await expect(page.getByLabel('Vibrate when I tap buttons or send a touch')).not.toBeChecked()
  await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('button', { name: 'Together', exact: true }).click()
  await expect(page.getByText('Connected', { exact: true })).toBeVisible()
  await page.evaluate(() => { (window as any).pulses = [] })
  await iphone.getByRole('button', { name: 'A kiss', exact: true }).click()
  await expect(page.locator('.touch-response')).toContainText('Alex blew a kiss.')
  await expect.poll(() => page.evaluate(() => (window as any).pulses.filter((p: unknown) => p !== 0))).toEqual([[60, 100, 110]])
  // This is a receiver preference; the sender still sends only the gesture kind.
  expect(store.requests.findLast(r => r.name === 'signal')?.body).toEqual({ p_kind: 'kiss' })
  await page.getByRole('button', { name: 'Vibration options', exact: true }).click()
  await page.getByLabel('Kiss vibration pattern').selectOption('off')
  await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('button', { name: 'Together', exact: true }).click()
  await page.evaluate(() => { (window as any).pulses = [] })
  await iphone.getByRole('button', { name: 'A kiss', exact: true }).click()
  await expect.poll(() => store.signals.length).toBe(2)
  await expect(page.locator('.touch-response')).toContainText('Alex blew a kiss.')
  expect(await page.evaluate(() => (window as any).pulses.filter((p: unknown) => p !== 0))).toEqual([])
  await context.close()
})

test('native previews use Core Haptics bridge, are local only, stop, and respect Quiet mode', async ({ page }) => {
  const store = makeRitualStore(); await mockRituals(page, store); await nativeBridge(page)
  await page.goto('/#settings')
  await expect(page.getByText('Touch vibrations are ready while Our Nook is open.')).toBeVisible()
  await page.getByLabel('Vibration strength').selectOption('strong')
  await page.getByLabel('Pulse length', { exact: true }).selectOption('long')
  await page.getByRole('button', { name: 'Preview Hug vibration', exact: true }).click()
  await expect(page.locator('.haptic-feedback')).toContainText('Nothing was sent to your partner.')
  const plays = await page.evaluate(() => (window as any).nativeCalls.filter((c: any) => c.method === 'play'))
  expect(plays.at(-1).options).toEqual({ pattern: [338, 130, 442], intensity: .9, sharpness: .1 })
  expect(store.requests.filter(r => r.name === 'signal')).toHaveLength(0)
  await page.evaluate(() => { (window as any).nativeCalls = [] })
  await page.getByRole('button', { name: 'Stop preview' }).click()
  await expect.poll(() => page.evaluate(() => (window as any).nativeCalls.some((c: any) => c.method === 'stop'))).toBe(true)
  await page.getByLabel('Quiet mode', { exact: true }).check()
  await page.getByRole('button', { name: 'Save my settings' }).click()
  await expect(page.getByRole('button', { name: 'Preview Hug vibration', exact: true })).toBeDisabled()
  await page.evaluate(() => { (window as any).nativeCalls = [] })
  store.signals.unshift({ id: crypto.randomUUID(), author_id: partnerId, kind: 'hug', created_at: new Date().toISOString() }); store.emit('nook_signals')
  await expect.poll(() => store.requests.filter(r => r.name === 'live_state').length).toBeGreaterThan(0)
  expect(await page.evaluate(() => (window as any).nativeCalls.filter((c: any) => c.method === 'play'))).toEqual([])
})

test('native iPhone receives a partner hug and does not replay old gestures after reopening', async ({ page, browser }) => {
  const store = makeRitualStore(); await mockRituals(page, store); await nativeBridge(page)
  const context = await browser.newContext(); const partner = await context.newPage(); await mockRituals(partner, store, true)
  await page.goto('/'); await partner.goto('http://127.0.0.1:4173/')
  await expect(page.getByText('Connected', { exact: true })).toBeVisible()
  await page.evaluate(() => { (window as any).nativeCalls = [] })
  await partner.getByRole('button', { name: 'A hug', exact: true }).click()
  await expect(page.locator('.touch-response')).toContainText('Alex sent a long-distance hug.')
  await expect.poll(() => page.evaluate(() => (window as any).nativeCalls.filter((c: any) => c.method === 'play').map((c: any) => c.options.pattern))).toEqual([[260, 130, 340]])
  await page.reload()
  await expect(page.getByText('Connected', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as any).nativeCalls.filter((c: any) => c.method === 'play'))).toEqual([])
  await context.close()
})

test('unsupported devices keep all send buttons usable and do not pretend previews vibrate', async ({ page }) => {
  await mockRituals(page); await browserVibrations(page, false)
  await page.goto('/#settings')
  await expect(page.getByRole('button', { name: 'Preview Kiss vibration' })).toBeDisabled()
  await expect(page.getByLabel('Vibration strength')).toHaveCount(0)
  await page.getByLabel('Hug vibration pattern').selectOption('heartbeat')
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  }
  await page.getByRole('navigation', { name: 'Mobile navigation', exact: true }).getByRole('button', { name: 'Together', exact: true }).click()
  await page.getByRole('button', { name: 'A hug', exact: true }).click()
  await expect(page.locator('.touch-response')).toContainText('You sent a long-distance hug.')
})

test('native password reset uses the configured HTTPS web callback', async ({ page }) => {
  const requests = await mockApp(page, { loggedIn: false }); await nativeBridge(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Set or reset password' }).click()
  await page.getByLabel('Email address').fill('mira@example.test')
  await page.getByRole('button', { name: 'Email me a password setup link' }).click()
  const reset = requests.find(r => r.path.endsWith('/auth/v1/recover'))
  expect(reset).toBeDefined()
  expect(new URLSearchParams(reset!.query).get('redirect_to')).toBe('https://our-nook.example.test/')
})
