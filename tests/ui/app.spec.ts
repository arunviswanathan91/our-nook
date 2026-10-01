import { test, expect, type Page } from '@playwright/test'

const userId = '11111111-1111-4111-8111-111111111111'
const partnerId = '22222222-2222-4222-8222-222222222222'
const coupleId = '33333333-3333-4333-8333-333333333333'
const testPassword = 'lantern-river-cloud-29'
const authUser = { id:userId,email:'mira@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString(),email_confirmed_at:new Date().toISOString() }
const testSession = () => ({ access_token:'test-access-token',refresh_token:'test-refresh-token',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,user:authUser })
async function mockApp(page: Page, { paired = true, loggedIn = true, joinError = false, emailError = '', passwordUpdateError = false, expiredSession = false } = {}) {
  let joined = paired
  let savedPassword = testPassword
  const profile = { id:userId,display_name:'Mira',avatar:'🌷',city:'Mumbai',country:'India',timezone:'Asia/Kolkata',time_format:'12',theme:'rose',status:'One little hello away' }
  const partner = { ...profile,id:partnerId,display_name:'Alex',avatar:'🐻',city:'Singapore',country:'Singapore',timezone:'Asia/Singapore',status:'Saving a hug for you' }
  const couple = { id:coupleId,title:'Our little nook',created_by:userId,anniversary:null,next_visit:null }
  const posts = [{ id:'post-1',couple_id:coupleId,author_id:partnerId,kind:'note',body:'A tiny reminder: you are my favourite part of the day.',link_url:null,storage_path:null,created_at:new Date().toISOString() }]
  const requests: { path:string; body:Record<string,unknown>; method:string; query:string }[] = []
  await page.route('https://nook-test.supabase.co/**', async route => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname
    const body = request.postDataJSON() || {}
    requests.push({ path,body,method:request.method(),query:url.search })
    if (path.endsWith('/auth/v1/token')) {
      if (url.searchParams.get('grant_type') === 'password' && body.password !== savedPassword) return route.fulfill({ status:400,headers:{ 'x-supabase-api-version':'2024-01-01','access-control-expose-headers':'x-supabase-api-version' },json:{ code:'invalid_credentials',msg:'Invalid login credentials' } })
      return route.fulfill({ json:testSession() })
    }
    if (['/auth/v1/otp','/auth/v1/recover','/auth/v1/signup'].some(endpoint => path.endsWith(endpoint))) {
      if (emailError) return route.fulfill({ status:429,headers:{ 'x-supabase-api-version':'2024-01-01','access-control-expose-headers':'x-supabase-api-version' },json:{ code:emailError,msg:'Email rate limit exceeded' } })
      return route.fulfill({ json:path.endsWith('/signup') ? { ...authUser,email_confirmed_at:undefined } : {} })
    }
    if (path.endsWith('/auth/v1/user')) {
      if (request.method() === 'PUT') {
        if (passwordUpdateError) return route.fulfill({ status:422,headers:{ 'x-supabase-api-version':'2024-01-01','access-control-expose-headers':'x-supabase-api-version' },json:{ code:'reauthentication_needed',msg:'Reauthentication required' } })
        savedPassword = String(body.password)
      }
      return route.fulfill({ json:authUser })
    }
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
    await page.addInitScript(({ session, expiredSession }) => {
      if (sessionStorage.getItem('nook-test-seeded')) return
      if (expiredSession) session.expires_at = Math.floor(Date.now()/1000)-60
      localStorage.setItem('sb-nook-test-auth-token',JSON.stringify(session))
      sessionStorage.setItem('nook-test-seeded','yes')
    },{ session:testSession(),expiredSession })
  }
  return requests
}

test('email-link fallback remains available for existing accounts', async ({ page }) => {
  const requests = await mockApp(page,{ loggedIn:false })
  await page.goto('/')
  await page.getByRole('button',{ name:'Use an email link',exact:true }).click()
  await page.getByLabel('Email address').fill('mira@example.test')
  await page.getByRole('button',{ name:'Email me a sign-in link' }).click()
  await expect(page.getByText('Your sign-in link is on its way.',{ exact:false })).toBeVisible()
  expect(requests.some(r=>r.path.endsWith('/otp') && r.body.email==='mira@example.test')).toBeTruthy()
  expect(requests.find(r=>r.path.endsWith('/otp'))?.body.create_user).toBe(false)
})

test('password login survives reload and another tab without emails, then sign-out removes access', async ({ page }) => {
  const requests = await mockApp(page,{ loggedIn:false })
  await page.goto('/')
  await page.getByLabel('Email address').fill('mira@example.test')
  await page.getByLabel('Password',{ exact:true }).fill(testPassword)
  await page.getByRole('form',{ name:'Password sign-in' }).getByRole('button',{ name:'Sign in',exact:true }).click()
  await expect(page.getByRole('heading',{ name:'A little time for us.' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading',{ name:'A little time for us.' })).toBeVisible()
  const otherTab = await page.context().newPage()
  const otherRequests = await mockApp(otherTab,{ loggedIn:false })
  await otherTab.goto('/')
  await expect(otherTab.getByRole('heading',{ name:'A little time for us.' })).toBeVisible()
  expect([...requests,...otherRequests].filter(r=>/\/(otp|recover|signup)$/.test(r.path))).toEqual([])
  await page.getByRole('button',{ name:'Sign out',exact:true }).click()
  await expect(page.getByRole('heading',{ name:'Come on in.' })).toBeVisible()
  await expect(otherTab.getByRole('heading',{ name:'Come on in.' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading',{ name:'Come on in.' })).toBeVisible()
  expect(requests.find(r=>r.path.endsWith('/logout'))?.query).toContain('scope=local')
  expect(await page.evaluate(()=>localStorage.getItem('sb-nook-test-auth-token'))).toBeNull()
})

test('invalid password does not load the private dashboard', async ({ page }) => {
  const requests = await mockApp(page,{ loggedIn:false })
  await page.goto('/')
  await page.getByLabel('Email address').fill('mira@example.test')
  await page.getByLabel('Password',{ exact:true }).fill('incorrect-password')
  await page.getByRole('form',{ name:'Password sign-in' }).getByRole('button',{ name:'Sign in',exact:true }).click()
  await expect(page.getByRole('alert')).toContainText('email or password is incorrect')
  expect(requests.some(r=>r.path.includes('/rest/v1/'))).toBe(false)
  await expect(page.getByLabel('Password',{ exact:true })).toHaveValue('')
})

test('expired stored access tokens refresh without asking for an email', async ({ page }) => {
  const requests = await mockApp(page,{ expiredSession:true })
  await page.goto('/')
  await expect(page.getByRole('heading',{ name:'A little time for us.' })).toBeVisible()
  expect(requests.some(r=>r.path.endsWith('/token') && r.query.includes('grant_type=refresh_token'))).toBe(true)
  expect(requests.some(r=>/\/(otp|recover)$/.test(r.path))).toBe(false)
})

test('signup validates matching passwords and waits for email confirmation', async ({ page }) => {
  const requests = await mockApp(page,{ loggedIn:false,paired:false })
  await page.goto('/')
  await page.getByRole('button',{ name:'Create account',exact:true }).click()
  await page.getByLabel('Email address').fill('mira@example.test')
  await page.getByLabel('New password',{ exact:true }).fill(testPassword)
  await page.getByLabel('Confirm new password',{ exact:true }).fill('different-long-password')
  await page.getByRole('form',{ name:'Create an account' }).getByRole('button',{ name:'Create account',exact:true }).click()
  await expect(page.getByRole('alert')).toContainText('do not match')
  expect(requests.some(r=>r.path.endsWith('/signup'))).toBe(false)
  await page.getByLabel('Confirm new password',{ exact:true }).fill(testPassword)
  await page.getByRole('form',{ name:'Create an account' }).getByRole('button',{ name:'Create account',exact:true }).click()
  await expect(page.getByRole('status')).toContainText('confirm your email once')
  expect(requests.find(r=>r.path.endsWith('/signup'))?.query).toContain('redirect_to=http%3A%2F%2F127.0.0.1%3A4173%2F')
  expect(requests.some(r=>r.path.includes('/rest/v1/'))).toBe(false)
})

test('password setup email uses the existing account and explains email rate limits', async ({ page }) => {
  const requests = await mockApp(page,{ loggedIn:false,emailError:'over_email_send_rate_limit' })
  await page.goto('/')
  await page.getByRole('button',{ name:'Set or reset password' }).click()
  await page.getByLabel('Email address').fill('mira@example.test')
  await page.getByRole('button',{ name:'Email me a password setup link' }).click()
  await expect(page.getByRole('alert')).toContainText('email-sending limit')
  expect(requests.find(r=>r.path.endsWith('/recover'))?.body.email).toBe('mira@example.test')
  expect(requests.some(r=>r.path.endsWith('/signup'))).toBe(false)
  await page.getByRole('button',{ name:'Back to sign in' }).click()
  await page.getByLabel('Password',{ exact:true }).fill(testPassword)
  await page.getByRole('form',{ name:'Password sign-in' }).getByRole('button',{ name:'Sign in',exact:true }).click()
  await expect(page.getByRole('heading',{ name:'A little time for us.' })).toBeVisible()
})

test('recovery callback and reload lead to password setup and preserve the existing nook', async ({ page }) => {
  const requests = await mockApp(page,{ loggedIn:false })
  await page.goto('/#access_token=test-access-token&refresh_token=test-refresh-token&token_type=bearer&expires_in=3600&type=recovery')
  await expect(page.getByRole('heading',{ name:'Choose your password.' })).toBeVisible()
  await expect(page).toHaveURL(/#set-password$/)
  await page.reload()
  await expect(page.getByRole('heading',{ name:'Choose your password.' })).toBeVisible()
  expect(requests.some(r=>r.path.includes('/rest/v1/'))).toBe(false)
  await page.getByLabel('New password',{ exact:true }).fill('new-lantern-password-42')
  await page.getByLabel('Confirm new password',{ exact:true }).fill('new-lantern-password-42')
  await page.getByRole('button',{ name:'Save password',exact:true }).click()
  await expect(page.getByRole('heading',{ name:'A little time for us.' })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('Password saved')
  expect(requests.find(r=>r.path.endsWith('/user') && r.method==='PUT')?.body.password).toBe('new-lantern-password-42')
  expect(requests.some(r=>/nook_(join|create)_couple/.test(r.path))).toBe(false)
  await page.getByRole('button',{ name:'Sign out',exact:true }).click()
  await page.getByLabel('Email address').fill('mira@example.test')
  await page.getByLabel('Password',{ exact:true }).fill('new-lantern-password-42')
  await page.getByRole('form',{ name:'Password sign-in' }).getByRole('button',{ name:'Sign in',exact:true }).click()
  await expect(page.getByRole('heading',{ name:'A little time for us.' })).toBeVisible()
})

test('password changes require a session and failed changes stay recoverable', async ({ page }) => {
  await mockApp(page,{ loggedIn:false,passwordUpdateError:true })
  await page.goto('/#set-password')
  await expect(page.getByRole('heading',{ name:'Come on in.' })).toBeVisible()
  await page.goto('/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('invalid or has expired')
  await page.goto('/#access_token=test-access-token&refresh_token=test-refresh-token&token_type=bearer&expires_in=3600&type=recovery')
  await page.reload()
  await expect(page.getByRole('heading',{ name:'Choose your password.' })).toBeVisible()
  await page.getByLabel('New password',{ exact:true }).fill(testPassword)
  await page.getByLabel('Confirm new password',{ exact:true }).fill(testPassword)
  await page.getByRole('button',{ name:'Save password',exact:true }).click()
  await expect(page.getByRole('alert')).toContainText('Please sign in again')
  await expect(page.getByRole('heading',{ name:'Choose your password.' })).toBeVisible()
})

test('signed-in users can set a password from Our space', async ({ page }) => {
  const requests = await mockApp(page)
  await page.goto('/')
  await page.getByRole('navigation',{ name:'Main navigation',exact:true }).getByRole('button',{ name:'Our space' }).click()
  await page.getByText('Set or change password',{ exact:true }).click()
  await page.getByLabel('New password',{ exact:true }).fill(testPassword)
  await page.getByLabel('Confirm new password',{ exact:true }).fill(testPassword)
  await page.getByRole('button',{ name:'Save password',exact:true }).click()
  await expect(page.getByRole('status')).toContainText('Password saved')
  expect(requests.some(r=>r.path.endsWith('/user') && r.method==='PUT')).toBe(true)
  expect(requests.some(r=>/\/(otp|recover)$/.test(r.path))).toBe(false)
})

test('password forms fit both phones and desktops', async ({ page },testInfo) => {
  await mockApp(page,{ loggedIn:false }); await page.goto('/')
  for (const width of [1440,390,320]) {
    await page.setViewportSize({ width,height:900 })
    for (const mode of ['signin','signup','recover']) {
      if (mode === 'signup') await page.getByRole('button',{ name:'Create account',exact:true }).click()
      if (mode === 'recover') { await page.getByRole('button',{ name:'Back to sign in' }).click(); await page.getByRole('button',{ name:'Set or reset password' }).click() }
      expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1),`${mode} at ${width}px`).toBe(true)
      if (mode === 'signin' && width !== 320) await page.screenshot({ path:testInfo.outputPath(`password-login-${width}.png`),fullPage:true })
    }
    await page.getByRole('button',{ name:'Back to sign in' }).click()
  }
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
