import { Link } from 'react-router-dom'
import { GraduationCap, ArrowLeft } from 'lucide-react'
import { Alert } from '../components/ui.jsx'
import { OverviewView } from './Overview.jsx'
import { DEMO_SUMMARY, DEMO_DESCRIPTORS } from '../lib/demoData.js'

export function SetupNeeded() {
  return (
    <div className="auth-form" style={{ minHeight: '100%' }}>
      <div className="auth-card stack" style={{ maxWidth: 560 }}>
        <div className="brand" style={{ color: 'var(--forest-800)' }}>
          <span className="brand-mark" style={{ background: 'var(--forest-800)', color: '#fff' }}><GraduationCap size={20} /></span>
          Classroom Gradebook
        </div>
        <h1>Connect your Supabase project</h1>
        <Alert type="warn">This app is not connected to a database yet, so sign-in and saving are switched off.</Alert>
        <ol className="stack" style={{ paddingLeft: 20, margin: 0 }}>
          <li>Create a project at supabase.com and run the SQL files in <code>supabase/migrations</code>, in order.</li>
          <li>Copy <code>.env.example</code> to <code>.env.local</code> and paste your project URL and public anon key.</li>
          <li>Restart <code>npm run dev</code>.</li>
        </ol>
        <p className="muted small">The README walks through each step. Only the public anon key goes in this file; never the service-role key.</p>
        <Link className="btn btn-primary" to="/demo">Preview the interface in demo mode</Link>
      </div>
    </div>
  )
}

export function DemoDashboard() {
  return (
    <div className="content">
      <div className="alert warn" style={{ marginBottom: 18 }} role="status">
        <div>
          <strong>DEMO MODE.</strong> These are fictional sample numbers so you can preview the interface. Nothing is saved
          and no database is connected.
        </div>
      </div>
      <div className="page-header">
        <div><h1>Overview</h1><p>Sample School - demo data</p></div>
        <Link className="btn" to="/"><ArrowLeft size={16} /> Back to setup</Link>
      </div>
      <OverviewView summary={DEMO_SUMMARY} descriptors={DEMO_DESCRIPTORS} termLabel="Term 1" actions={false} />
    </div>
  )
}
