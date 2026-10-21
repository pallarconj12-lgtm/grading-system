import { useState } from 'react'
import { BookOpen, ClipboardCheck, BarChart3, GraduationCap, Pencil, User, Mail, Lock } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { Alert, Button, Field, PasswordInput } from '../components/ui.jsx'
import { errorMessage } from '../lib/format.js'

function Logo() {
  return (
    <svg className="auth-logo" viewBox="0 0 120 120" role="img" aria-label="Grading System">
      <rect x="31" y="40" width="50" height="64" rx="7" fill="#fff" stroke="#1b2f66" strokeWidth="5" />
      <path d="M10 34 60 13l50 21-50 21z" fill="#1b2f66" />
      <path d="M104 37v20" stroke="#1b2f66" strokeWidth="4" strokeLinecap="round" />
      <rect x="100" y="55" width="8" height="10" rx="3" fill="#1b2f66" />
      <text x="42" y="82" fontSize="22" fontWeight="700" fill="#6b82b3" fontFamily="inherit">A+</text>
      <path d="M41 91h26M41 98h18" stroke="#9db0d3" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="84" cy="96" r="15" fill="#3dbf86" />
      <path d="m77 96 5 5 9-10" fill="none" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Light-blue backdrop with soft shapes and line-art school icons, used by every sign-in screen. */
export function AuthShell({ children }) {
  return (
    <div className="auth-wrap">
      <div className="auth-deco" aria-hidden="true">
        <svg className="wave wave-tl" viewBox="0 0 300 230"><path d="M0 0h280C270 70 210 110 130 135 70 153 20 175 0 205z" /></svg>
        <svg className="wave wave-br" viewBox="0 0 420 300"><path d="M420 0C380 80 300 120 220 150 150 176 80 230 40 300h380z" /></svg>
        <BookOpen className="deco d1" strokeWidth={1.2} />
        <span className="deco d2">A+</span>
        <Pencil className="deco d3" strokeWidth={1.2} />
        <ClipboardCheck className="deco d4" strokeWidth={1.2} />
        <BarChart3 className="deco d5" strokeWidth={1.2} />
        <GraduationCap className="deco d6" strokeWidth={1.2} />
      </div>
      <div className="auth-form">{children}</div>
    </div>
  )
}

export default function Login() {
  const { signIn, signUp, resetPassword } = useAuth()
  const toast = useToast()
  const [mode, setMode] = useState('signin') // signin | signup | reset
  const [form, setForm] = useState({ email: '', password: '', name: '' })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    setError('')
    setNotice('')
    const email = form.email.trim()
    if (!email) return setError('Enter your e-mail address.')
    if (mode !== 'reset' && form.password.length < 8) return setError('Use a password of at least 8 characters.')
    if (mode === 'signup' && !form.name.trim()) return setError('Enter your full name.')
    setBusy(true)
    try {
      if (mode === 'signin') await signIn(email, form.password)
      if (mode === 'signup') {
        const { needsConfirmation } = await signUp(email, form.password, form.name.trim())
        if (needsConfirmation) setNotice('Account created. Check your e-mail and open the confirmation link, then sign in.')
        else toast.success('Welcome!')
      }
      if (mode === 'reset') {
        await resetPassword(email)
        setNotice('If that e-mail has an account, a reset link is on its way.')
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const subtitle = { signin: 'Login to your account', signup: 'Create your account', reset: 'Reset your password' }[mode]
  const action = { signin: 'Login', signup: 'Create account', reset: 'Send reset link' }[mode]

  return (
    <AuthShell>
      <form className="auth-card" onSubmit={submit} noValidate>
        <Logo />
        <h1>Grading System</h1>
        <p className="auth-sub">{subtitle}</p>
        <div className="auth-fields">
          {error && <Alert type="danger">{error}</Alert>}
          {notice && <Alert type="ok">{notice}</Alert>}
          {mode === 'signup' && (
            <Field label="Full name" className="sr-label">
              <div className="auth-input"><User className="input-lead" size={19} aria-hidden /><input className="input has-lead" placeholder="Full name" value={form.name} onChange={set('name')} autoComplete="name" /></div>
            </Field>
          )}
          <Field label="E-mail" className="sr-label">
            <div className="auth-input"><Mail className="input-lead" size={19} aria-hidden /><input className="input has-lead" type="email" placeholder="Email" value={form.email} onChange={set('email')} autoComplete="email" /></div>
          </Field>
          {mode !== 'reset' && (
            <Field label="Password" className="sr-label" help={mode === 'signup' ? 'At least 8 characters.' : undefined}>
              <PasswordInput icon={Lock} placeholder="Password" value={form.password} onChange={set('password')} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} />
            </Field>
          )}
        </div>
        <Button type="submit" variant="primary" className="auth-submit" disabled={busy}>{busy ? 'Please wait...' : action}</Button>
        <div className="auth-links">
          {mode === 'signin' ? (
            <>
              <button type="button" className="auth-link" onClick={() => setMode('reset')}>Forgot your password?</button>
              <button type="button" className="auth-link auth-link-quiet" onClick={() => setMode('signup')}>Create an account</button>
            </>
          ) : (
            <button type="button" className="auth-link" onClick={() => setMode('signin')}>Back to login</button>
          )}
        </div>
      </form>
    </AuthShell>
  )
}

export function ResetPassword() {
  const { updatePassword } = useAuth()
  const toast = useToast()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    if (password.length < 8) return setError('Use a password of at least 8 characters.')
    setBusy(true)
    try {
      await updatePassword(password)
      toast.success('Password updated.')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <AuthShell>
      <form className="auth-card" onSubmit={submit}>
        <Logo />
        <h1>Grading System</h1>
        <p className="auth-sub">Choose a new password</p>
        <div className="auth-fields">
          {error && <Alert type="danger">{error}</Alert>}
          <Field label="New password" className="sr-label" help="At least 8 characters.">
            <PasswordInput icon={Lock} placeholder="New password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </Field>
        </div>
        <Button type="submit" variant="primary" className="auth-submit" disabled={busy}>{busy ? 'Saving...' : 'Update password'}</Button>
      </form>
    </AuthShell>
  )
}
