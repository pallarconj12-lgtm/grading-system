import { useState } from 'react'
import { GraduationCap } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { Alert, Button, Field, PasswordInput } from '../components/ui.jsx'
import { errorMessage } from '../lib/format.js'

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

  const title = { signin: 'Sign in', signup: 'Create your account', reset: 'Reset your password' }[mode]

  return (
    <div className="auth-wrap">
      <div className="auth-art">
        <div className="brand"><span className="brand-mark"><GraduationCap size={20} /></span> Classroom Gradebook</div>
        <div>
          <h1>Grades, attendance and report cards in one place.</h1>
          <p>Built for Junior and Senior High School teachers in the Philippines. Your records stay in your school's own secure database.</p>
          <div className="ledger" aria-hidden="true">
            <div className="ledger-title"><span>Sample class record</span><span>Quarter 1</span></div>
            <table>
              <thead><tr><th>Learner</th><th>WW</th><th>PT</th><th>QA</th><th>Grade</th></tr></thead>
              <tbody>
                <tr><td>Learner A</td><td>92</td><td>95</td><td>88</td><td>93</td></tr>
                <tr><td>Learner B</td><td>85</td><td>90</td><td>82</td><td>89</td></tr>
                <tr><td>Learner C</td><td>78</td><td>84</td><td>80</td><td>84</td></tr>
                <tr><td>Learner D</td><td>74</td><td>70</td><td>66</td><td>74</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <span className="small auth-note">Grading rules are configurable and must be verified against the applicable DepEd issuance.</span>
      </div>
      <div className="auth-form">
        <form className="auth-card stack" onSubmit={submit} noValidate>
          <div className="auth-brand-mobile"><span className="brand-mark"><GraduationCap size={20} /></span> Classroom Gradebook</div>
          <div>
            <h1>{title}</h1>
            <p className="muted" style={{ marginTop: 4 }}>
              {mode === 'signin' && 'Welcome back. Enter your details to continue.'}
              {mode === 'signup' && 'Use your school e-mail. You will create or join a school next.'}
              {mode === 'reset' && 'We will e-mail you a link to choose a new password.'}
            </p>
          </div>
          {error && <Alert type="danger">{error}</Alert>}
          {notice && <Alert type="ok">{notice}</Alert>}
          {mode === 'signup' && (
            <Field label="Full name"><input className="input" value={form.name} onChange={set('name')} autoComplete="name" /></Field>
          )}
          <Field label="E-mail"><input className="input" type="email" value={form.email} onChange={set('email')} autoComplete="email" /></Field>
          {mode !== 'reset' && (
            <Field label="Password" help={mode === 'signup' ? 'At least 8 characters.' : undefined}>
              <PasswordInput value={form.password} onChange={set('password')} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} />
            </Field>
          )}
          {mode === 'signin' && (
            <div className="auth-forgot"><button type="button" className="auth-link" onClick={() => setMode('reset')}>Forgot password?</button></div>
          )}
          <Button type="submit" variant="primary" className="auth-submit" disabled={busy}>{busy ? 'Please wait...' : title}</Button>
          <p className="auth-switch">
            {mode === 'signin' ? (
              <>New to Classroom Gradebook? <button type="button" className="auth-link" onClick={() => setMode('signup')}>Create an account</button></>
            ) : (
              <button type="button" className="auth-link" onClick={() => setMode('signin')}>Back to sign in</button>
            )}
          </p>
        </form>
      </div>
    </div>
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
    <div className="auth-form" style={{ minHeight: '100%' }}>
      <form className="auth-card stack" onSubmit={submit}>
        <h1>Choose a new password</h1>
        {error && <Alert type="danger">{error}</Alert>}
        <Field label="New password" help="At least 8 characters.">
          <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Saving...' : 'Update password'}</Button>
      </form>
    </div>
  )
}
