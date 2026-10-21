import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Users, Layers, BookOpen, CheckCircle2, BarChart3, CalendarCheck, UserPlus, Table2, FileText } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts'
import { supabase, unwrap } from '../lib/supabase.js'
import { useSchool } from '../context/SchoolContext.jsx'
import { useAsync } from '../lib/hooks.js'
import { bucketHistogram } from '../lib/grading/index.js'
import { summarizeAttendance } from '../lib/attendance.js'
import { fmtNum, fmtPct, todayIso } from '../lib/format.js'
import { Alert, Button, EmptyState, Loading, PageHeader, Select, StatCard } from '../components/ui.jsx'

const BAR_COLORS = ['#184a37', '#2b7a5c', '#5aa07f', '#b9a14a', '#b4503b']

/** Presentational dashboard. Used with real data by <Overview/> and with fictional data by the demo page. */
export function OverviewView({ summary, descriptors, termLabel, actions = true }) {
  const buckets = bucketHistogram(summary.histogram, descriptors)
  const att = summary.attendance
  const rate = summarizeAttendance(
    [...Array(att.present).fill({ status: 'present' }), ...Array(att.absent).fill({ status: 'absent' }),
      ...Array(att.late).fill({ status: 'late' }), ...Array(att.excused).fill({ status: 'excused' })],
  ).rate

  return (
    <div className="stack">
      <div className="stat-grid">
        <StatCard icon={Users} label="Enrolled students" value={summary.students} />
        <StatCard icon={Layers} label="Class sections" value={summary.sections} />
        <StatCard icon={BookOpen} label="Subjects handled" value={summary.subjects} />
        <StatCard icon={CheckCircle2} label="Students with completed grades" value={summary.students_complete}
          hint={`${termLabel}: every subject graded, no missing scores`} />
        <StatCard icon={BarChart3} label="Class average" value={summary.class_average === null ? '-' : fmtNum(summary.class_average, 1)}
          hint={`Mean transmuted grade, ${termLabel}`} />
        <StatCard icon={CalendarCheck} label="Attendance on selected date" value={att.total === 0 ? '-' : fmtPct(rate, 0)}
          hint={att.total === 0 ? 'No attendance recorded' : `${att.present} present, ${att.late} late, ${att.absent} absent, ${att.excused} excused`} />
      </div>

      {actions && (
        <div className="card card-pad">
          <h3 style={{ marginBottom: 12 }}>Quick actions</h3>
          <div className="row">
            <Link className="btn" to="/students?add=1"><UserPlus size={17} /> Add student</Link>
            <Link className="btn" to="/gradebook"><Table2 size={17} /> Enter grades</Link>
            <Link className="btn" to="/attendance"><CalendarCheck size={17} /> Record attendance</Link>
            <Link className="btn" to="/reports"><FileText size={17} /> Generate reports</Link>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head"><h2>Grade distribution, {termLabel}</h2></div>
        <div className="card-pad">
          {buckets.every((b) => b.count === 0) ? (
            <EmptyState icon={BarChart3} title="No computed grades yet">Grades appear here as soon as scores are entered.</EmptyState>
          ) : (
            <div style={{ height: 260 }} role="img" aria-label="Bar chart of the number of grades in each descriptor band">
              <ResponsiveContainer>
                <BarChart data={buckets} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e3ebe5" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v) => [v, 'Grades']} />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                    {buckets.map((_, i) => <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Overview() {
  const s = useSchool()
  const [periodId, setPeriodId] = useState('')
  const [date, setDate] = useState(todayIso())
  const period = s.periods.find((p) => p.id === periodId) ?? s.periods[0]

  const { data, loading, error } = useAsync(
    async () =>
      unwrap(await supabase.rpc('dashboard_summary', { p_school: s.school.id, p_year: s.year.id, p_period: period.id, p_date: date })),
    [s.school.id, s.year?.id, period?.id, date],
    { enabled: Boolean(s.year && period) },
  )

  return (
    <>
      <PageHeader title="Overview" subtitle={`${s.school.name} - ${s.year?.label ?? 'no school year'}`}>
        <Select value={period?.id} onChange={setPeriodId} options={s.periods.map((p) => ({ value: p.id, label: p.name }))} aria-label="Grading period" />
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Attendance date" style={{ width: 'auto' }} />
      </PageHeader>
      {!s.year || !period ? (
        <Alert type="warn">Create a school year with grading periods in Settings first.</Alert>
      ) : loading ? (
        <Loading />
      ) : error ? (
        <Alert type="danger">{error.message}</Alert>
      ) : (
        <>
          {data.students === 0 && s.can('students.write') && (
            <Alert type="info" className="no-print">
              No learners yet. <Link to="/students">Add learners</Link> or import a CSV to get started.
            </Alert>
          )}
          <div className="spacer" />
          <OverviewView summary={data} descriptors={s.descriptors} termLabel={period.name} />
        </>
      )}
    </>
  )
}
