import { useState } from 'react'
import { LogOut } from 'lucide-react'
import { supabase, unwrap } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useSchool } from '../context/SchoolContext.jsx'
import { useRunner } from '../lib/hooks.js'
import { Alert, Badge, Button, Field, PageHeader, PasswordInput } from '../components/ui.jsx'
import { ROLE_LABELS } from '../lib/permissions.js'

export default function Account() {
  const { user, signOut, updatePassword } = useAuth()
  const s = useSchool()
  const { busy, run } = useRunner()
  const [name, setName] = useState(s.profile?.full_name ?? '')
  const [pw, setPw] = useState({ a: '', b: '' })
  const [pwError, setPwError] = useState('')

  async function saveName() {
    if (!name.trim()) return
    const r = await run(async () => unwrap(await supabase.from('profiles').update({ full_name: name.trim() }).eq('id', user.id)), 'Profile updated.')
    if (r.ok) s.reload()
  }

  async function savePassword() {
    setPwError('')
    if (pw.a.length < 8) return setPwError('Use a password of at least 8 characters.')
    if (pw.a !== pw.b) return setPwError('The two passwords do not match.')
    const r = await run(() => updatePassword(pw.a), 'Password changed.')
    if (r.ok) setPw({ a: '', b: '' })
  }

  return (
    <>
      <PageHeader title="Account" subtitle="Your profile and sign-in details" />
      <div className="stack" style={{ maxWidth: 640 }}>
        <div className="card card-pad stack">
          <h2>Profile</h2>
          <div className="row"><span className="muted">E-mail</span><strong>{user.email}</strong></div>
          <div className="row"><span className="muted">Role</span><Badge>{ROLE_LABELS[s.role]}</Badge><span className="muted small">at {s.school.name}</span></div>
          <Field label="Full name (shown on reports)"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <div><Button variant="primary" onClick={saveName} disabled={busy || name.trim() === (s.profile?.full_name ?? '')}>Save name</Button></div>
        </div>
        <div className="card card-pad stack">
          <h2>Change password</h2>
          {pwError && <Alert type="danger">{pwError}</Alert>}
          <Field label="New password"><PasswordInput autoComplete="new-password" value={pw.a} onChange={(e) => setPw((p) => ({ ...p, a: e.target.value }))} /></Field>
          <Field label="Repeat new password"><PasswordInput autoComplete="new-password" value={pw.b} onChange={(e) => setPw((p) => ({ ...p, b: e.target.value }))} /></Field>
          <div><Button variant="primary" onClick={savePassword} disabled={busy}>Change password</Button></div>
        </div>
        <div><Button icon={LogOut} onClick={signOut}>Log out</Button></div>
      </div>
    </>
  )
}
