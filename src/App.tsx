import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { LoaderCircle, LogOut } from 'lucide-react'
import { clearMediaCache, errorText, initialAuthError, initialPasswordRecovery, loadNook, rpc, signOut, supabase, type Nook } from './lib'
import { Notice, Onboarding, type Action } from './Base'
import { AuthScreen, PasswordPanel, PasswordRecoveryScreen, authErrorText } from './Auth'
import { Brand } from './Brand'

const Dashboard = lazy(() => import('./Dashboard').then(module => ({ default: module.Dashboard })))

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [booting, setBooting] = useState(true)
  const [passwordRecovery, setPasswordRecovery] = useState(initialPasswordRecovery)
  const [nook, setNook] = useState<Nook | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  const [invite, setInvite] = useState<string | null>(null)
  const [postLimit, setPostLimit] = useState(60)
  const activeUser = useRef<string | null>(null)
  const refreshTicket = useRef(0)
  const mutationLock = useRef(false)

  useEffect(() => {
    if (!supabase) { setBooting(false); return }
    let mounted = true
    const { data } = supabase.auth.onAuthStateChange((event, value) => {
      setSession(value)
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecovery(true)
        window.history.replaceState(null, '', `${window.location.pathname}#set-password`)
      }
      if (!value) {
        activeUser.current = null; setNook(null); setInvite(null); clearMediaCache()
        if (event === 'SIGNED_OUT') {
          setPasswordRecovery(false)
          window.history.replaceState(null, '', window.location.pathname)
        }
      }
    })
    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return
      if (error) setNotice({ text: authErrorText(error), error: true })
      setSession(data.session); setBooting(false)
    }).catch(error => { if (mounted) { setNotice({ text: authErrorText(error), error: true }); setBooting(false) } })
    return () => { mounted = false; data.subscription.unsubscribe() }
  }, [])
  const refresh = useCallback(async () => {
    if (!session) return
    const user = session.user.id
    const ticket = ++refreshTicket.current
    const next = await loadNook(user, postLimit)
    if (activeUser.current === user && ticket === refreshTicket.current) setNook(next)
  }, [session?.user.id, postLimit])
  useEffect(() => {
    activeUser.current = session?.user.id || null
    if (!session || passwordRecovery) return
    void refresh().catch(error => setNotice({ text: errorText(error), error: true }))
  }, [session?.user.id, refresh, passwordRecovery])
  useEffect(() => {
    if (!nook?.couple || !supabase) return
    const id = nook.couple.id
    const update = () => { void refresh().catch(() => {}) }
    const channel = supabase.channel(`nook:${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'nook_posts', filter: `couple_id=eq.${id}` }, update)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'nook_games', filter: `couple_id=eq.${id}` }, update)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'nook_members', filter: `couple_id=eq.${id}` }, update)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'nook_profiles' }, update)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'nook_couples', filter: `id=eq.${id}` }, update)
      .subscribe()
    const onFocus = () => { if (!document.hidden) update() }
    const timer = window.setInterval(onFocus, 60000)
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); void supabase?.removeChannel(channel) }
  }, [nook?.couple?.id, refresh])
  useEffect(() => { document.documentElement.dataset.theme = nook?.profile.theme || 'rose' }, [nook?.profile.theme])

  const act: Action = async (work, message, onError) => {
    if (mutationLock.current) return false
    mutationLock.current = true; setBusy(true); setNotice(null)
    try {
      await work()
      try { await refresh() } catch { setNotice({ text: 'Saved, but the latest view could not load. Refresh when you are back online.', error: true }); return true }
      if (message) setNotice({ text: message, error: false })
      return true
    } catch (error) { const text = errorText(error); setNotice({ text, error: true }); onError?.(text); return false }
    finally { mutationLock.current = false; setBusy(false) }
  }
  async function makeInvite() {
    await act(async () => { const result = await rpc<{ code: string }>('issue_invite'); setInvite(result.code) })
  }

  if (booting) return <div className="full-center"><LoaderCircle className="spin" aria-label="Opening Our Nook" /></div>
  if (!session) return <AuthScreen initialError={notice?.error ? notice.text : initialAuthError} />
  if (passwordRecovery) return <PasswordRecoveryScreen email={session.user.email} onSaved={() => {
    setPasswordRecovery(false)
    window.history.replaceState(null, '', window.location.pathname)
    setNotice({ text: 'Password saved. Next time, sign in with your email and password.', error: false })
  }} />
  if (!nook) return <div className="full-center"><Brand /><p>{notice?.text || 'Opening your little corner…'}</p><button className="button" onClick={() => void act(refresh)}>Try again</button><button className="text-button" onClick={() => void signOut()}>Sign out</button></div>
  if (!nook.couple) return <div className="onboarding-page"><Brand />{notice && <Notice notice={notice} close={() => setNotice(null)} />}<Onboarding profile={nook.profile} act={act} busy={busy} joined={() => {}} invite={setInvite} /><PasswordPanel email={session.user.email} /><button className="text-button" onClick={() => void act(() => signOut())}><LogOut /> Sign out</button></div>

  return <Suspense fallback={<div className="full-center"><LoaderCircle className="spin" aria-label="Opening your shared space" /></div>}><Dashboard nook={nook} session={session} act={act} busy={busy} notice={notice} setNotice={setNotice} invite={invite} setInvite={setInvite} makeInvite={makeInvite} postLimit={postLimit} setPostLimit={setPostLimit} /></Suspense>
}
