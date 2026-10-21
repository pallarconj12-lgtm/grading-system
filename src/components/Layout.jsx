import { useState } from 'react'
import { NavLink, Outlet, Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Users, BookOpen, Layers, Table2, CalendarCheck, FileText, Settings,
  UserCircle, LogOut, GraduationCap, Menu, AlertTriangle,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { useSchool } from '../context/SchoolContext.jsx'
import { ROLE_LABELS } from '../lib/permissions.js'
import { Select } from './ui.jsx'

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/students', label: 'Students', icon: Users },
  { to: '/subjects', label: 'Subjects', icon: BookOpen },
  { to: '/sections', label: 'Sections', icon: Layers },
  { to: '/gradebook', label: 'Gradebook', icon: Table2 },
  { to: '/attendance', label: 'Attendance', icon: CalendarCheck },
  { to: '/reports', label: 'Reports', icon: FileText },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export default function Layout() {
  const { signOut } = useAuth()
  const s = useSchool()
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const close = () => setOpen(false)

  return (
    <div className="app">
      <div className={`scrim ${open ? 'open' : ''}`} onClick={close} />
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Main navigation">
        <div className="brand">
          <span className="brand-mark"><GraduationCap size={20} /></span>
          Classroom Gradebook
        </div>
        <nav className="nav">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} onClick={close} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon size={18} aria-hidden /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="user-chip">
            <strong>{s.profile?.full_name || s.profile?.email}</strong>
            {ROLE_LABELS[s.role]}
          </div>
          <NavLink to="/account" onClick={close} className={({ isActive }) => (isActive ? 'active' : '')}>
            <UserCircle size={18} aria-hidden /> Account
          </NavLink>
          <button className="nav-btn" onClick={signOut}>
            <LogOut size={18} aria-hidden /> Log out
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar no-print">
          <button className="btn btn-icon menu-btn" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={20} /></button>
          <div className="grow">
            <strong style={{ fontFamily: 'var(--font-head)' }}>{s.school.name}</strong>
          </div>
          <label className="row small muted" style={{ gap: 8 }}>
            School year
            <Select
              value={s.year?.id}
              onChange={s.setYearId}
              options={s.years.map((y) => ({ value: y.id, label: y.label + (y.is_current ? ' (current)' : '') }))}
              aria-label="School year"
              style={{ minWidth: 150 }}
            />
          </label>
        </header>
        <main className="content">
          {s.anyUnverified && location.pathname !== '/settings' && (
            <div className="alert warn no-print" style={{ marginBottom: 18 }}>
              <AlertTriangle size={18} aria-hidden />
              <div>
                <strong>Grading rules are not verified.</strong> The weights and transmutation table were entered from
                public summaries of DepEd Order No. 015, s. 2026 and have not been checked against the official issuance.
                Treat computed grades as provisional.{' '}
                {s.can('grading.configure') ? <Link to="/settings">Review and verify in Settings</Link> : 'Ask your administrator to verify them.'}
              </div>
            </div>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  )
}
