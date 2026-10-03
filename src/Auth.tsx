import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowRight, Eye, EyeOff, HeartHandshake, KeyRound, LoaderCircle, LockKeyhole, Mail, Sparkles } from 'lucide-react'
import { Brand } from './Brand'
import { configured, db, errorText, signOut } from './lib'
import { isNativeApp } from './haptics'

type AuthMode = 'signin' | 'signup' | 'recover' | 'link'
const MIN_PASSWORD_LENGTH = 12

function authRedirect() {
  // Confirmation/reset emails open the existing HTTPS site. Password sign-in
  // works inside the native app, without adding a custom auth redirect scheme.
  if (isNativeApp()) {
    const url = new URL(import.meta.env.VITE_PUBLIC_WEB_URL)
    if (url.protocol !== 'https:') throw new Error('Email access needs the public HTTPS website configured for this app.')
    return url.href
  }
  return new URL('.', window.location.href).href
}

export function authErrorText(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  if (code === 'invalid_credentials') return 'The email or password is incorrect. If you used an email link before, choose “Set or reset password” to create your first password.'
  if (code === 'email_not_confirmed') return 'Confirm your email using the link in your inbox, then sign in with your password.'
  if (code === 'over_email_send_rate_limit' || /email rate limit/i.test(errorText(error))) return 'The app has reached its email-sending limit. Wait about an hour before requesting another email. If you already set a password, you can still sign in with it.'
  if (code === 'over_request_rate_limit') return 'Too many attempts. Wait a little before trying again.'
  if (code === 'reauthentication_needed' || code === 'session_not_found') return 'Please sign in again, then set your password. You can also use a new password reset email.'
  return errorText(error)
}

function PasswordField({ label, value, onChange, creating = false, disabled = false }: { label: string; value: string; onChange: (value: string) => void; creating?: boolean; disabled?: boolean }) {
  const [visible, setVisible] = useState(false)
  const id = useId()
  return <div className="password-field">
    <label htmlFor={id}>{label}</label>
    <div className="password-input">
      <input id={id} type={visible ? 'text' : 'password'} required disabled={disabled} autoComplete={creating ? 'new-password' : 'current-password'} autoCapitalize="none" spellCheck={false} minLength={creating ? MIN_PASSWORD_LENGTH : undefined} maxLength={creating ? 128 : undefined} value={value} onChange={event => onChange(event.target.value)} />
      <button className="icon-button" type="button" aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`} aria-pressed={visible} disabled={disabled} onClick={() => setVisible(value => !value)}>{visible ? <EyeOff /> : <Eye />}</button>
    </div>
  </div>
}

function AuthShell({ children }: { children: ReactNode }) {
  return <div className="auth-page">
    <div className="auth-story"><Brand /><div><p className="eyebrow">A PRIVATE PLACE FOR TWO</p><h1>All the little things.<br /><em>All in one place.</em></h1><p>A song that sounds like them. A photo of your day.<br />A little love, left for later.</p></div><span className="auth-footer"><HeartHandshake /> A little closer, wherever you are.</span></div>
    <div className="auth-form-wrap"><div className="auth-form">{children}</div></div>
  </div>
}

export function AuthScreen({ initialError = '' }: { initialError?: string }) {
  const [mode, setMode] = useState<AuthMode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState(initialError)
  const submitting = useRef(false)

  function changeMode(next: AuthMode) {
    if (submitting.current) return
    setMode(next); setPassword(''); setConfirmation(''); setError(''); setMessage(''); setSent(false)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (submitting.current || sent) return
    setError(''); setMessage('')
    if (mode === 'signup' && password !== confirmation) { setError('The passwords do not match. Please type them again.'); return }
    submitting.current = true; setBusy(true)
    try {
      const client = db()
      if (mode === 'signin') {
        const { error } = await client.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
      } else if (mode === 'signup') {
        const { error } = await client.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: authRedirect() } })
        if (error) throw error
        setMessage('Check your inbox to confirm your email once. After that, use your email and password to sign in. Already have an account? Sign in or set/reset your password.')
        setSent(true)
      } else if (mode === 'recover') {
        const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: authRedirect() })
        if (error) throw error
        setMessage('If an account exists for that email, a password setup link is on its way. Open the newest email to choose your password. Your existing nook stays with your account.')
        setSent(true)
      } else {
        const { error } = await client.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: authRedirect(), shouldCreateUser: false } })
        if (error) throw error
        setMessage('Your sign-in link is on its way. Open the email, then set a password in Our space for next time.')
        setSent(true)
      }
    } catch (error) { setError(authErrorText(error)) }
    finally { setPassword(''); setConfirmation(''); submitting.current = false; setBusy(false) }
  }

  const heading = { signin: 'Come on in.', signup: 'Make yourself at home.', recover: 'A password for next time.', link: 'A little link home.' }[mode]
  const description = {
    signin: 'Sign in with your email and password. Your little corner will be here when you come back.',
    signup: 'Create your own account, then start a nook or join your partner with their invitation code.',
    recover: 'Used an email link before? Enter that same email to set your first password or reset an existing one.',
    link: 'Use a one-time email link to return to your existing account.',
  }[mode]
  const submitLabel = { signin: 'Sign in', signup: 'Create account', recover: 'Email me a password setup link', link: 'Email me a sign-in link' }[mode]

  return <AuthShell>
    <span className="form-kicker"><LockKeyhole /></span><h2>{heading}</h2><p>{description}</p>
    {configured ? <>
      {(mode === 'signin' || mode === 'signup') && <div className="segmented auth-tabs" aria-label="Account access"><button type="button" disabled={busy} aria-pressed={mode === 'signin'} onClick={() => changeMode('signin')}>Sign in</button><button type="button" disabled={busy} aria-pressed={mode === 'signup'} onClick={() => changeMode('signup')}>Create account</button></div>}
      <form onSubmit={submit} aria-label={mode === 'signin' ? 'Password sign-in' : mode === 'signup' ? 'Create an account' : 'Email account access'}>
        <label>Email address<input type="email" autoComplete="username" required disabled={busy} value={email} onChange={event => { setEmail(event.target.value); setSent(false) }} placeholder="you@example.com" /></label>
        {(mode === 'signin' || mode === 'signup') && <PasswordField label={mode === 'signup' ? 'New password' : 'Password'} creating={mode === 'signup'} value={password} onChange={setPassword} disabled={busy} />}
        {mode === 'signup' && <><PasswordField label="Confirm new password" creating value={confirmation} onChange={setConfirmation} disabled={busy} /><small>Use at least {MIN_PASSWORD_LENGTH} characters. You’ll confirm your email once before your first sign-in.</small></>}
        {mode === 'signin' && <small>Stay signed in on this device. Use Sign out when you want to end your session.</small>}
        <button className="button full" disabled={busy || sent}>{busy ? <LoaderCircle className="spin" /> : mode === 'signin' ? <ArrowRight /> : <Mail />}{sent ? 'Check your inbox' : submitLabel}</button>
        {(mode === 'recover' || mode === 'link') && <small>This email is only for access to your account. Your partner invitation code is separate.</small>}
      </form>
      {isNativeApp() && mode !== 'signin' && <p className="footnote">Email links open our website. After confirming your email or setting a password there, return here and sign in with your email and password.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="form-message" role="status">{message}</p>}
      <div className="auth-links">
        {mode === 'signin' ? <><button className="text-button" type="button" disabled={busy} onClick={() => changeMode('recover')}>Set or reset password</button><button className="text-button" type="button" disabled={busy} onClick={() => changeMode('link')}>Use an email link</button></> : <button className="text-button" type="button" disabled={busy} onClick={() => changeMode('signin')}>Back to sign in</button>}
      </div>
    </> : <div className="setup-message"><Sparkles /><strong>Our Nook is getting ready.</strong><p>Sign-in will open once setup is complete.</p></div>}
  </AuthShell>
}

function PasswordForm({ email, onSaved }: { email?: string; onSaved?: () => void }) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const submitting = useRef(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (submitting.current) return
    setError(''); setMessage('')
    if (password.length < MIN_PASSWORD_LENGTH) { setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`); return }
    if (password !== confirmation) { setError('The passwords do not match. Please type them again.'); return }
    submitting.current = true; setBusy(true)
    try {
      const { error } = await db().auth.updateUser({ password })
      if (error) throw error
      setMessage('Password saved. You can now sign in with your email and password.')
      onSaved?.()
    } catch (error) { setError(authErrorText(error)) }
    finally { setPassword(''); setConfirmation(''); submitting.current = false; setBusy(false) }
  }

  return <form className="stack-form" aria-label="Set your password" onSubmit={submit}>
    <label>Account email<input type="email" autoComplete="username" readOnly value={email || ''} /></label>
    <PasswordField label="New password" creating value={password} onChange={setPassword} disabled={busy} />
    <PasswordField label="Confirm new password" creating value={confirmation} onChange={setConfirmation} disabled={busy} />
    <small className="muted">At least {MIN_PASSWORD_LENGTH} characters. Your nook and partner connection stay the same.</small>
    <button className="button" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <KeyRound />}Save password</button>
    {error && <p className="form-error" role="alert">{error}</p>}
    {message && <p className="form-message" role="status">{message}</p>}
  </form>
}

export function PasswordPanel({ email }: { email?: string }) {
  return <section className="panel password-panel"><h2>Password & sign-in</h2><p>Set a password once to come back without an email link. You stay signed in on this device until you sign out or your session ends.</p><details><summary>Set or change password</summary><PasswordForm email={email} /></details></section>
}

export function PasswordRecoveryScreen({ email, onSaved }: { email?: string; onSaved: () => void }) {
  const [error, setError] = useState('')
  return <AuthShell><span className="form-kicker"><KeyRound /></span><h2>Choose your password.</h2><p>One small setup, then come back with your email and password.</p><PasswordForm email={email} onSaved={onSaved} /><button className="text-button" type="button" onClick={() => void signOut().catch(error => setError(authErrorText(error)))}>Cancel and sign out</button>{error && <p className="form-error" role="alert">{error}</p>}</AuthShell>
}
