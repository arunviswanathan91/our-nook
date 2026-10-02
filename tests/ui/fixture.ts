import { type Page } from '@playwright/test'

export const userId = '11111111-1111-4111-8111-111111111111'
export const partnerId = '22222222-2222-4222-8222-222222222222'
export const coupleId = '33333333-3333-4333-8333-333333333333'
export const testPassword = 'lantern-river-cloud-29'
const authUser = { id:userId,email:'mira@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString(),email_confirmed_at:new Date().toISOString() }
const testSession = (user = authUser) => ({ access_token:'test-access-token',refresh_token:'test-refresh-token',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,user })
export async function mockApp(page: Page, { paired = true, loggedIn = true, joinError = false, emailError = '', passwordUpdateError = false, expiredSession = false, asPartner = false } = {}) {
  const currentUser={...authUser,id:asPartner?partnerId:userId,email:asPartner?'alex@example.test':authUser.email}
  let joined = paired
  let savedPassword = testPassword
  let profile = { id:userId,display_name:'Mira',avatar:'🌷',city:'Mumbai',country:'India',timezone:'Asia/Kolkata',time_format:'12',theme:'rose',status:'One little hello away' }
  let partner = { ...profile,id:partnerId,display_name:'Alex',avatar:'🐻',city:'Singapore',country:'Singapore',timezone:'Asia/Singapore',status:'Saving a hug for you' }
  if(asPartner)[profile,partner]=[partner,profile]
  const couple = { id:coupleId,title:'Our little nook',created_by:userId,anniversary:null,next_visit:null }
  const posts = [{ id:'post-1',couple_id:coupleId,author_id:partnerId,kind:'note',body:'A tiny reminder: you are my favourite part of the day.',link_url:null,storage_path:null,created_at:new Date().toISOString() }]
  const requests: { path:string; body:Record<string,unknown>; method:string; query:string }[] = []
  await page.route('https://nook-test.supabase.co/**', async route => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname
    const body = request.postDataJSON() || {}
    requests.push({ path,body,method:request.method(),query:url.search })
    if (path.endsWith('/auth/v1/token')) {
      if (url.searchParams.get('grant_type') === 'password' && body.password !== savedPassword) return route.fulfill({ status:400,headers:{ 'x-supabase-api-version':'2024-01-01','access-control-expose-headers':'x-supabase-api-version' },json:{ code:'invalid_credentials',msg:'Invalid login credentials' } })
      return route.fulfill({ json:testSession(currentUser) })
    }
    if (['/auth/v1/otp','/auth/v1/recover','/auth/v1/signup'].some(endpoint => path.endsWith(endpoint))) {
      if (emailError) return route.fulfill({ status:429,headers:{ 'x-supabase-api-version':'2024-01-01','access-control-expose-headers':'x-supabase-api-version' },json:{ code:emailError,msg:'Email rate limit exceeded' } })
      return route.fulfill({ json:path.endsWith('/signup') ? { ...currentUser,email_confirmed_at:undefined } : {} })
    }
    if (path.endsWith('/auth/v1/user')) {
      if (request.method() === 'PUT') {
        if (passwordUpdateError) return route.fulfill({ status:422,headers:{ 'x-supabase-api-version':'2024-01-01','access-control-expose-headers':'x-supabase-api-version' },json:{ code:'reauthentication_needed',msg:'Reauthentication required' } })
        savedPassword = String(body.password)
      }
      return route.fulfill({ json:currentUser })
    }
    if (path.includes('/auth/v1/logout')) return route.fulfill({ status:204 })
    if (path.includes('/rpc/nook_join_couple')) {
      if (joinError) return route.fulfill({ json:{ error:'That code is invalid, expired, or already used.' } })
      joined=true; return route.fulfill({ json:{ couple_id:coupleId } })
    }
    if (request.method() === 'POST' && path.endsWith('nook_posts')) { posts.unshift({ ...body,id:'post-'+Date.now(),created_at:new Date().toISOString() } as typeof posts[number]); return route.fulfill({ status:201,body:'' }) }
    if (request.method() === 'PATCH' && path.endsWith('nook_couples')) { Object.assign(couple,body); return route.fulfill({ status:204 }) }
    if (request.method() === 'PATCH' && path.endsWith('nook_profiles')) { Object.assign(profile,body); return route.fulfill({ status:204 }) }
    if (request.method() === 'POST') return route.fulfill({ status:201,body:'' })
    let rows: unknown[] = []
    if (path.endsWith('nook_profiles')) rows = url.searchParams.has('id') && url.searchParams.get('id')?.startsWith('eq.') ? [profile] : [profile,partner]
    if (path.endsWith('nook_members')) rows = !joined ? [] : url.searchParams.has('user_id') ? [{ user_id:profile.id,couple_id:coupleId }] : [{ user_id:profile.id,couple_id:coupleId },{ user_id:partner.id,couple_id:coupleId }]
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
    },{ session:testSession(currentUser),expiredSession })
  }
  return requests
}

