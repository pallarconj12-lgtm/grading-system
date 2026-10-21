import { useMemo, useState } from 'react'
import { CalendarCheck, Download, Printer, CheckCheck } from 'lucide-react'
import { supabase, fetchAll, unwrap } from '../lib/supabase.js'
import { useSchool } from '../context/SchoolContext.jsx'
import { useAsync, useRunner } from '../lib/hooks.js'
import { Alert, Badge, Button, EmptyState, Field, Loading, PageHeader, Select, Tabs } from '../components/ui.jsx'
import { ATTENDANCE_LABELS, ATTENDANCE_STATUSES, groupAttendance, monthKey, summarizeAttendance } from '../lib/attendance.js'
import { downloadCsv, ExcelText } from '../lib/csv.js'
import { fmtDate, fmtPct, fullName, todayIso } from '../lib/format.js'

const SHORT = { present: 'P', absent: 'A', late: 'L', excused: 'E' }

export default function Attendance() {
  const s = useSchool()
  const [tab, setTab] = useState('daily')
  const [sectionId, setSectionId] = useState('')
  const sections = s.yearSections.slice().sort((a, b) => s.sectionLabel(a.id).localeCompare(s.sectionLabel(b.id)))
  const section = sections.find((x) => x.id === sectionId) ?? sections[0]

  if (sections.length === 0) {
    return (<><PageHeader title="Attendance" /><div className="card"><EmptyState icon={CalendarCheck} title="No sections available">You do not have access to a section for {s.year?.label ?? 'this school year'} yet.</EmptyState></div></>)
  }
  return (
    <>
      <PageHeader title="Attendance" subtitle="Mark attendance by section and day. One record per learner per day." />
      <div className="toolbar no-print">
        <Select value={section.id} onChange={setSectionId} options={sections.map((x) => ({ value: x.id, label: s.sectionLabel(x.id) }))} aria-label="Section" />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'daily', label: 'Mark attendance' }, { value: 'report', label: 'Monthly report' }]} />
      {tab === 'daily' ? <Daily key={section.id} section={section} /> : <Report key={section.id} section={section} />}
    </>
  )
}

function Daily({ section }) {
  const s = useSchool()
  const { busy, run } = useRunner()
  const [date, setDate] = useState(todayIso())
  const [draft, setDraft] = useState({}) // student_id -> { status, remarks }
  const [version, setVersion] = useState(0)
  const canWrite = s.can('attendance.write')

  const { data, loading, error } = useAsync(async () => {
    const [students, rows] = await Promise.all([
      fetchAll(() => supabase.from('students').select('id,lrn,first_name,middle_name,last_name,suffix').eq('section_id', section.id).eq('status', 'enrolled').order('last_name').order('first_name').order('id')),
      fetchAll(() => supabase.from('attendance').select('*').eq('section_id', section.id).eq('attendance_date', date).order('id')),
    ])
    setDraft({})
    return { students, saved: Object.fromEntries(rows.map((r) => [r.student_id, r])) }
  }, [section.id, date, version])

  const weekend = [0, 6].includes(new Date(`${date}T00:00:00`).getDay())
  const current = (id) => draft[id] ?? (data?.saved[id] ? { status: data.saved[id].status, remarks: data.saved[id].remarks ?? '' } : null)
  const dirty = Object.keys(draft).length
  const rowsNow = useMemo(() => (data ? data.students.map((st) => current(st.id)).filter(Boolean) : []), [data, draft]) // eslint-disable-line
  const sum = summarizeAttendance(rowsNow, s.settings)
  const unmarked = data ? data.students.length - rowsNow.length : 0

  const set = (id, patch) => setDraft((d) => ({ ...d, [id]: { status: current(id)?.status ?? 'present', remarks: current(id)?.remarks ?? '', ...patch } }))
  const markAll = (status) => setDraft((d) => Object.fromEntries([...Object.entries(d), ...data.students.map((st) => [st.id, { status, remarks: current(st.id)?.remarks ?? '' }])]))

  async function save() {
    const payload = Object.entries(draft).map(([student_id, v]) => ({
      school_id: s.school.id, section_id: section.id, student_id, attendance_date: date, status: v.status, remarks: v.remarks?.trim() || null, marked_by: s.user.id,
    }))
    const r = await run(async () => unwrap(await supabase.from('attendance').upsert(payload, { onConflict: 'student_id,attendance_date' })), `Saved attendance for ${payload.length} learner(s).`)
    if (r.ok) setVersion((n) => n + 1)
  }

  return (
    <div className="card">
      <div className="card-head">
        <div className="row">
          <Field label="Date"><input className="input" type="date" value={date} max={todayIso()} onChange={(e) => e.target.value && setDate(e.target.value)} /></Field>
        </div>
        {canWrite && data?.students.length > 0 && (
          <div className="row">
            <Button size="sm" icon={CheckCheck} onClick={() => markAll('present')} disabled={busy}>Mark all present</Button>
            <Button variant="primary" onClick={save} disabled={busy || dirty === 0}>{busy ? 'Saving...' : dirty ? `Save ${dirty} change(s)` : 'Saved'}</Button>
          </div>
        )}
      </div>
      {weekend && <div className="card-pad"><Alert type="warn">{fmtDate(date)} is a weekend. Record attendance only if classes were held.</Alert></div>}
      {loading && !data ? <Loading /> : error ? <div className="card-pad"><Alert type="danger">{error.message}</Alert></div> : data.students.length === 0 ? (
        <EmptyState icon={CalendarCheck} title="No enrolled learners in this section" />
      ) : (
        <>
          <div className="card-pad row">
            {ATTENDANCE_STATUSES.map((k) => <Badge key={k} tone={k === 'present' ? 'ok' : k === 'absent' ? 'danger' : k === 'late' ? 'warn' : 'info'}>{ATTENDANCE_LABELS[k]}: {sum[k]}</Badge>)}
            <Badge tone={unmarked ? 'warn' : 'ok'}>{unmarked ? `${unmarked} not marked` : 'All marked'}</Badge>
            <span className="muted small">Attendance rate: {fmtPct(sum.rate, 1)}</span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Learner</th><th>Status</th><th>Remarks</th></tr></thead>
              <tbody>
                {data.students.map((st) => {
                  const c = current(st.id)
                  return (
                    <tr key={st.id}>
                      <td><strong>{fullName(st)}</strong><span className="muted small" style={{ display: 'block' }}>{st.lrn}</span></td>
                      <td>
                        <div className="seg" role="radiogroup" aria-label={`Attendance for ${fullName(st)}`}>
                          {ATTENDANCE_STATUSES.map((k) => (
                            <button key={k} type="button" role="radio" aria-checked={c?.status === k} disabled={!canWrite}
                              className={`seg-btn ${c?.status === k ? `on on-${k}` : ''}`} onClick={() => set(st.id, { status: k })}>{ATTENDANCE_LABELS[k]}</button>
                          ))}
                        </div>
                      </td>
                      <td><input className="input" maxLength={200} value={c?.remarks ?? ''} disabled={!canWrite || !c} placeholder={c ? '' : 'Mark a status first'} aria-label={`Remarks for ${fullName(st)}`} onChange={(e) => set(st.id, { remarks: e.target.value })} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function Report({ section }) {
  const s = useSchool()
  const [month, setMonth] = useState(todayIso().slice(0, 7))

  const { data, loading, error } = useAsync(async () => {
    const first = `${month}-01`
    const last = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()
    const [students, rows] = await Promise.all([
      fetchAll(() => supabase.from('students').select('id,lrn,first_name,middle_name,last_name,suffix').eq('section_id', section.id).eq('status', 'enrolled').order('last_name').order('first_name').order('id')),
      fetchAll(() => supabase.from('attendance').select('student_id,attendance_date,status').eq('section_id', section.id).gte('attendance_date', first).lte('attendance_date', `${month}-${String(last).padStart(2, '0')}`).order('id')),
    ])
    return { students, rows, last }
  }, [section.id, month])

  const days = data ? Array.from({ length: data.last }, (_, i) => i + 1) : []
  const byKey = useMemo(() => new Map((data?.rows ?? []).map((r) => [`${r.student_id}:${Number(r.attendance_date.slice(8))}`, r.status])), [data])
  const perStudent = useMemo(() => {
    if (!data) return {}
    return Object.fromEntries(groupAttendance(data.rows, (r) => r.student_id, s.settings).map((g) => [g.key, g]))
  }, [data, s.settings])
  const total = summarizeAttendance(data?.rows ?? [], s.settings)
  const daysRecorded = new Set((data?.rows ?? []).map((r) => r.attendance_date)).size

  function exportCsv() {
    const head = ['LRN', 'Learner', ...days, 'Present', 'Late', 'Absent', 'Excused', 'Attendance rate %']
    const body = data.students.map((st) => {
      const g = perStudent[st.id] ?? { present: 0, late: 0, absent: 0, excused: 0, rate: null }
      return [new ExcelText(st.lrn), fullName(st), ...days.map((d) => SHORT[byKey.get(`${st.id}:${d}`)] ?? ''), g.present, g.late, g.absent, g.excused, g.rate === null ? '' : Math.round(g.rate * 10) / 10]
    })
    downloadCsv(`attendance-${s.sectionLabel(section.id)}-${month}.csv`.replace(/\s+/g, '_'), [head, ...body])
  }

  return (
    <div className="card">
      <div className="card-head no-print">
        <Field label="Month"><input className="input" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></Field>
        <div className="row">
          <Button icon={Download} onClick={exportCsv} disabled={!data}>Export CSV</Button>
          <Button icon={Printer} onClick={() => window.print()} disabled={!data}>Print</Button>
        </div>
      </div>
      {loading && !data ? <Loading /> : error ? <div className="card-pad"><Alert type="danger">{error.message}</Alert></div> : (
        <div className="sheet-print" style={{ display: 'block' }}>
          <div className="card-pad">
            <h2>{s.school.name} - Monthly Attendance</h2>
            <p className="muted">{s.sectionLabel(section.id)} - {monthKey(month)} - {daysRecorded} day(s) with records - Rate {fmtPct(total.rate, 1)}
              <span className="no-print"> - Late counts as present: {s.settings?.late_counts_as_present ? 'yes' : 'no'}; Excused counts as present: {s.settings?.excused_counts_as_present ? 'yes' : 'no'} (change in Settings)</span></p>
          </div>
          <div className="table-wrap">
            <table className="table att-grid">
              <thead><tr><th>Learner</th>{days.map((d) => <th key={d}>{d}</th>)}<th>P</th><th>L</th><th>A</th><th>E</th><th>Rate</th></tr></thead>
              <tbody>
                {data.students.map((st) => {
                  const g = perStudent[st.id] ?? { present: 0, late: 0, absent: 0, excused: 0, rate: null }
                  return (
                    <tr key={st.id}>
                      <td className="name">{fullName(st)}</td>
                      {days.map((d) => { const v = byKey.get(`${st.id}:${d}`); return <td key={d} className={v ? `att-${v}` : ''}>{v ? SHORT[v] : ''}</td> })}
                      <td>{g.present}</td><td>{g.late}</td><td>{g.absent}</td><td>{g.excused}</td><td>{fmtPct(g.rate, 0)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small card-pad">P = present, L = late, A = absent, E = excused. Blank = not recorded (not counted as absent).</p>
        </div>
      )}
    </div>
  )
}
