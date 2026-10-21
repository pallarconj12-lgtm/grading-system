import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { isConfigured } from './lib/supabase.js'
import { AuthProvider, useAuth } from './context/AuthContext.jsx'
import { SchoolProvider, useSchool } from './context/SchoolContext.jsx'
import Layout from './components/Layout.jsx'
import { Loading, Alert, Button } from './components/ui.jsx'
import Login, { ResetPassword } from './pages/Login.jsx'
import Onboarding from './pages/Onboarding.jsx'
import { SetupNeeded, DemoDashboard } from './pages/SetupNeeded.jsx'

import Overview from './pages/Overview.jsx'
const Students = lazy(() => import('./pages/Students.jsx'))
const Subjects = lazy(() => import('./pages/Subjects.jsx'))
const Sections = lazy(() => import('./pages/Sections.jsx'))
const Gradebook = lazy(() => import('./pages/Gradebook.jsx'))
const Attendance = lazy(() => import('./pages/Attendance.jsx'))
const Reports = lazy(() => import('./pages/Reports.jsx'))
const SettingsPage = lazy(() => import('./pages/Settings.jsx'))
const Account = lazy(() => import('./pages/Account.jsx'))

function SchoolGate() {
  const s = useSchool()
  if (s.loading) return <Loading label="Loading your school..." />
  if (s.error) {
    return (
      <div style={{ padding: 40, maxWidth: 560, margin: '0 auto' }} className="stack">
        <Alert type="danger">Your school data could not be loaded: {s.error.message}</Alert>
        <Button onClick={s.reload}>Try again</Button>
      </div>
    )
  }
  if (!s.school) return <Onboarding />

  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="students" element={<Students />} />
          <Route path="subjects" element={<Subjects />} />
          <Route path="sections" element={<Sections />} />
          <Route path="gradebook" element={<Gradebook />} />
          <Route path="attendance" element={<Attendance />} />
          <Route path="reports" element={<Reports />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="account" element={<Account />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}

function AuthGate() {
  const { session, loading, recovering } = useAuth()
  if (loading) return <Loading />
  if (recovering) return <ResetPassword />
  if (!session) return <Login />
  return (
    <SchoolProvider>
      <SchoolGate />
    </SchoolProvider>
  )
}

export default function App() {
  if (!isConfigured) {
    return (
      <Routes>
        <Route path="/demo" element={<DemoDashboard />} />
        <Route path="*" element={<SetupNeeded />} />
      </Routes>
    )
  }
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  )
}
