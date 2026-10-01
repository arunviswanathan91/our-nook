import { test, expect, type Page } from '@playwright/test'

const userId = '11111111-1111-4111-8111-111111111111'
const partnerId = '22222222-2222-4222-8222-222222222222'
const coupleId = '33333333-3333-4333-8333-333333333333'
async function mockApp(page: Page, { paired = true, loggedIn = true, joinError = false } = {}) {
  let joined = paired
  const profile = { id:userId,display_name:'Mira',avatar:'🌷',city:'Mumbai',country:'India',timezone:'Asia/Kolkata',time_format:'12',theme:'rose',status:'One little hello away' }
  const partner = { ...profile,id:partnerId,display_name:'Alex',avatar:'🐻',city:'Singapore',country:'Singapore',timezone:'Asia/Singapore',status:'Saving a hug for you' }
  const couple = { id:coupleId,title:'Our little nook',created_by:userId,anniversary:null,next_visit:null }
  const posts = [{ id:'post-1',couple_id:coupleId,author_id:partnerId,kind:'note',body:'A tiny reminder: you are my favourite part of the day.',link_url:null,storage_path:null,created_at:new Date().toISOString() }]
  const requests: { path:string; body:Record<string,unknown> }[] = []
  await page.route('https://nook-test.supabase.co/**', async route => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname
    const body = request.postDataJSON() || {}
    requests.push({ path,body })
    if (path.includes('/auth/v1/otp')) return route.fulfill({ json:{} })
    if (path.includes('/auth/v1/logout')) return route.fulfill({ status:204 })
    if (path.includes('/rpc/nook_join_couple')) {
      if (joinError) return route.fulfill({ json:{ error:'That code is invalid, expired, or already used.' } })
      joined=true; return route.fulfill({ json:{ couple_id:coupleId } })
    }
    if (request.method() === 'POST' && path.endsWith('nook_posts')) { posts.unshift({ ...body,id:'post-'+Date.now(),created_at:new Date().toISOString() } as typeof posts[number]); return route.fulfill({ status:201,body:'' }) }
    if (request.method() === 'PATCH' && path.endsWith('nook_profiles')) { Object.assign(profile,body); return route.fulfill({ status:204 }) }
    if (request.method() === 'POST') return route.fulfill({ status:201,body:'' })
    let rows: unknown[] = []
    if (path.endsWith('nook_profiles')) rows = url.searchParams.has('id') && url.searchParams.get('id')?.startsWith('eq.') ? [profile] : [profile,partner]
    if (path.endsWith('nook_members')) rows = !joined ? [] : url.searchParams.has('user_id') ? [{ user_id:userId,couple_id:coupleId }] : [{ user_id:userId,couple_id:coupleId },{ user_id:partnerId,couple_id:coupleId }]
    if (path.endsWith('nook_couples')) rows = [couple]
    if (path.endsWith('nook_posts')) rows = posts
    return route.fulfill({ json:request.headers().accept?.includes('application/vnd.pgrst.object+json') ? rows[0] || null : rows })
  })
  if (loggedIn) {
    await page.addInitScript(({ userId }) => {
      const session = { access_token:'test-access-token',refresh_token:'test-refresh-token',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,user:{ id:userId,email:'mira@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString() } }
      localStorage.setItem('sb-nook-test-auth-token',JSON.stringify(session))
    },{ userId })
  }
  return requests
}

test('email login requests a magic link', async ({ page }) => {
  const requests = await mockApp(page,{ loggedIn:false })
  await page.goto('/')
  await page.getByLabel('Email address').fill('mira@example.test')
  await page.getByRole('button',{ name:'Email me a sign-in link' }).click()
  await expect(page.getByText('Your sign-in link is on its way.',{ exact:false })).toBeVisible()
  expect(requests.some(r=>r.path.endsWith('/otp') && r.body.email==='mira@example.test')).toBeTruthy()
})

test('partner code joins a space and reveals only the paired dashboard', async ({ page }) => {
  const requests = await mockApp(page,{ paired:false })
  await page.goto('/')
  await page.getByRole('button',{ name:'I have a code' }).click()
  await page.getByLabel('Partner invitation code').fill('abcd-1234-abcd-1234-abcd')
  await page.getByRole('button',{ name:/Join/i }).click()
  await expect(page.getByRole('heading',{ name:'A little time for us.' })).toBeVisible()
  expect(requests.find(r=>r.path.endsWith('nook_join_couple'))?.body.p_code).toBe('ABCD-1234-ABCD-1234-ABCD')
})

test('invalid partner code stays on onboarding with an error', async ({ page }) => {
  await mockApp(page,{ paired:false,joinError:true }); await page.goto('/')
  await page.getByRole('button',{ name:'I have a code' }).click()
  await page.getByLabel('Partner invitation code').fill('used-code')
  await page.getByRole('button',{ name:/Join/i }).click()
  await expect(page.getByRole('alert')).toContainText('invalid, expired, or already used')
  await expect(page.getByRole('heading',{ name:'A nook for two.' })).toBeVisible()
})

test('notes, song validation, and profile edits work on a phone', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror',error=>errors.push(error.message))
  await page.setViewportSize({ width:390,height:844 }); const requests = await mockApp(page); await page.goto('/')
  await page.getByLabel('Write a note',{ exact:true }).fill('A little hello from my day')
  await page.getByRole('button',{ name:'Leave this here' }).click()
  await expect(page.getByText('A little hello from my day',{ exact:true })).toBeVisible()
  await page.getByRole('navigation',{ name:'Mobile navigation' }).getByRole('button',{ name:'Mixtape' }).click()
  await page.getByRole('button',{ name:'Add music',exact:true }).click()
  await page.getByLabel('Song or playlist link').fill('https://untrusted.example/song')
  await page.getByRole('button',{ name:'Save to our nook' }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Use an https link')
  await page.getByLabel('Song or playlist link').fill('https://open.spotify.com/playlist/example')
  await page.getByRole('button',{ name:'Save to our nook' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.getByRole('navigation',{ name:'Mobile navigation' }).getByRole('button',{ name:'Our space' }).click()
  await page.getByLabel('City (optional)',{ exact:true }).fill('Bengaluru')
  await page.getByRole('button',{ name:'Save my settings' }).click()
  await expect(page.getByRole('status')).toBeVisible()
  expect(requests.some(r=>r.body.city==='Bengaluru')).toBeTruthy(); expect(errors).toEqual([])
})

test('desktop and phone pages fit the viewport', async ({ page },testInfo) => {
  await mockApp(page); await page.goto('/')
  for (const width of [1440,768,390,320]) {
    await page.setViewportSize({ width,height:900 })
    const nav = page.getByRole('navigation',{ name:width>850 ? 'Main navigation' : 'Mobile navigation',exact:true })
    for (const name of ['Today','Keepsakes','Mixtape','Play','Our space']) {
      await nav.getByRole('button',{ name,exact:true }).click()
      await expect(page.locator('main')).toBeVisible()
      expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1),`${name} at ${width}px`).toBeTruthy()
    }
    await nav.getByRole('button',{ name:'Today',exact:true }).click()
    if (width === 1440 || width === 390) await page.screenshot({ path:testInfo.outputPath(`today-${width}.png`),fullPage:true })
  }
})
