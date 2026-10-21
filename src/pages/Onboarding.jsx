import { useState } from 'react'
import { School, LogOut } from 'lucide-react'
import { supabase, friendlyError } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useSchool } from '../context/SchoolContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { Alert, Button, Field } from '../components/ui.jsx'

/** Shown to a signed-in user who does not belong to a school yet. */
export default function Onboarding() {
  const { user, signOut } = useAuth()
  const { reload } = useSchool()
  const toast = useToast()
  const [name, setName] = useState('')
  const [yearLabel, setYearLabel] = useState('')
  const [terms, setTerms] = useState('3')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function create(e) {
    e.preventDefault()
    if (!name.trim()) return setError('Enter the school name.')
    setBusy(true)
    setError('')
    const { error: err } = await supabase.rpc('bootstrap_school', {
      p_name: name.trim(),
      p_year_label: yearLabel.trim() || null,
      p_term_count: Number(terms),
    })
    setBusy(false)
    if (err) return setError(friendlyError(err))
    toast.success('School created. You are its administrator.')
    reload()
  }

  return (
    <div className="auth-form" style={{ minHeight: '100%' }}>
      <div className="auth-card stack" style={{ maxWidth: 520 }}>
        <div>
          <h1>Set up your school</h1>
          <p className="muted" style={{ marginTop: 4 }}>Signed in as {user.email}</p>
        </div>

        <form className="card card-pad stack" onSubmit={create}>
          <h2 className="row"><School size={20} /> Create a new school</h2>
          <p className="muted small">You become the administrator and can then add teachers, sections and subjects.</p>
          {error && <Alert type="danger">{error}</Alert>}
          <Field label="School name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <div className="form-grid">
            <Field label="School year label" help="Leave blank to use the current school year.">
              <input className="input" placeholder="2026-2027" value={yearLabel} onChange={(e) => setYearLabel(e.target.value)} />
            </Field>
            <Field label="Grading periods per year">
              <select className="select" value={terms} onChange={(e) => setTerms(e.target.value)}>
                <option value="3">3 terms (DepEd Order 015, s. 2026 calendar)</option>
                <option value="4">4 quarters</option>
              </select>
            </Field>
          </div>
          <Alert type="warn">
            Default grading rules follow public summaries of DepEd Order No. 015, s. 2026 and are marked <strong>not verified</strong>.
            You will verify them in Settings before relying on any grade.
          </Alert>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Creating...' : 'Create school'}</Button>
        </form>

        <div className="card card-pad">
          <h3>Joining an existing school?</h3>
          <p className="muted small" style={{ marginTop: 6 }}>
            Ask your school administrator to add you by e-mail ({user.email}) under Settings, Users and roles.
            Then press refresh.
          </p>
          <div className="row" style={{ marginTop: 12 }}>
            <Button onClick={reload}>Refresh</Button>
            <Button variant="ghost" icon={LogOut} onClick={signOut}>Log out</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
