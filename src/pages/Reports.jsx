import { useMemo, useState } from 'react'
import { Download, Printer, FileText, ScrollText } from 'lucide-react'
import { supabase, fetchAll } from '../lib/supabase.js'
import { useSchool } from '../context/SchoolContext.jsx'
import { useAsync } from '../lib/hooks.js'
import { Alert, Badge, Button, EmptyState, Loading, PageHeader, Pager, Select, Tabs } from '../components/ui.jsx'
import PrintPage from '../components/PrintPage.jsx'
import { computeGeneralAverage, descriptorFor, remarkFor } from '../lib/grading/index.js'
import { summarizeAttendance } from '../lib/attendance.js'
import { downloadCsv, ExcelText } from '../lib/csv.js'
import { fmtGrade, fullName } from '../lib/format.js'
import { SEMESTER_LABELS, periodsForSemester } from '../lib/semester.js'

const OFFICIAL = new Set(['finalized', 'approved'])

export default function Reports() {
  const s = useSchool()
  const [tab, setTab] = useState('cards')
  const tabs = [{ value: 'cards', label: 'Report cards' }, { value: 'summary', label: 'Class grade summary' }]
  if (s.can('audit.read')) tabs.push({ value: 'audit', label: 'Audit log' })
  return (
    <>
      <PageHeader title="Reports" subtitle="Preview and print report cards and grading sheets" />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'cards' ? <Cards /> : tab === 'summary' ? <Summary /> : <Audit />}
    </>
  )
}

/** Shared loader: everything needed for one section across all subjects and terms. */
function useSectionGrades(section) {
  const s = useSchool()
  return useAsync(async () => {
    const assignments = s.yearAssignments.filter((a) => a.section_id === section.id)
    const ids = assignments.map((a) => a.id)
    const periodIds = s.periods.map((p) => p.id)
    const [students, quarterly, finals, attendance] = await Promise.all([
      fetchAll(() => supabase.from('students').select('id,lrn,first_name,middle_name,last_name,suffix,sex').eq('section_id', section.id).eq('status', 'enrolled').order('last_name').order('first_name').order('id')),
      ids.length ? fetchAll(() => supabase.from('quarterly_grades').select('student_id,assignment_id,grading_period_id,transmuted_grade,status,is_complete').in('assignment_id', ids).in('grading_period_id', periodIds).order('id')) : [],
      ids.length ? fetchAll(() => supabase.from('final_grades').select('student_id,assignment_id,final_grade,status').in('assignment_id', ids).order('id')) : [],
      fetchAll(() => supabase.from('attendance').select('student_id,status').eq('section_id', section.id).gte('attendance_date', s.year.start_date ?? '1900-01-01').lte('attendance_date', s.year.end_date ?? '2999-12-31').order('id')),
    ])
    const subjects = assignments.map((a) => ({ a, subject: s.subjects.find((x) => x.id === a.subject_id), config: s.configs.find((c) => c.id === s.subjects.find((x) => x.id === a.subject_id)?.grading_configuration_id) }))
      .filter((x) => x.subject).sort((x, y) => (x.subject.sort_order ?? 0) - (y.subject.sort_order ?? 0))
    return { students, quarterly, finals, attendance, subjects }
  }, [section?.id, s.year?.id, s.periods.length], { enabled: Boolean(section) })
}

function useSectionPicker() {
  const s = useSchool()
  const sections = s.yearSections.slice().sort((a, b) => s.sectionLabel(a.id).localeCompare(s.sectionLabel(b.id)))
  const [id, setId] = useState('')
  return { sections, section: sections.find((x) => x.id === id) ?? sections[0], setId }
}

function Cards() {
  const s = useSchool()
  const { sections, section, setId } = useSectionPicker()
  const [learner, setLearner] = useState('all')
  const [includeProvisional, setIncludeProvisional] = useState(false)
  const { data, loading, error } = useSectionGrades(section)

  if (!section) return <div className="card"><EmptyState icon={FileText} title="No sections available" /></div>

  const students = data ? (learner === 'all' ? data.students : data.students.filter((x) => x.id === learner)) : []
  const shown = (g) => g && g.transmuted_grade !== null && (OFFICIAL.has(g.status) || includeProvisional)

  return (
    <>
      <div className="toolbar no-print">
        <Select value={section.id} onChange={(v) => { setId(v); setLearner('all') }} options={sections.map((x) => ({ value: x.id, label: s.sectionLabel(x.id) }))} aria-label="Section" />
        <Select value={learner} onChange={setLearner} options={[{ value: 'all', label: 'All learners in section' }, ...(data?.students ?? []).map((x) => ({ value: x.id, label: fullName(x) }))]} aria-label="Learner" />
        <label className="check"><input type="checkbox" checked={includeProvisional} onChange={(e) => setIncludeProvisional(e.target.checked)} /> Include provisional grades (watermarked)</label>
        <span className="grow" />
        <Button variant="primary" icon={Printer} disabled={!students.length} onClick={() => window.print()}>Print {learner === 'all' ? `${students.length} report card(s)` : 'report card'}</Button>
      </div>
      <Alert type="info" className="no-print">Only <strong>finalized or approved</strong> grades appear on a report card by default. Print one learner, or the whole section with a page break between learners. Use your browser's print dialog to save as PDF.</Alert>
      <div className="spacer no-print" />
      {loading && !data ? <Loading /> : error ? <Alert type="danger">{error.message}</Alert> : !data.subjects.length ? (
        <div className="card"><EmptyState icon={FileText} title="No classes in this section yet" /></div>
      ) : !students.length ? <div className="card"><EmptyState icon={FileText} title="No learners to show" /></div> : (
        <div className="stack">
          <PrintPage paper={s.settings?.default_paper} margin="12mm" />
          {students.map((st) => <ReportCard key={st.id} st={st} section={section} data={data} shown={shown} includeProvisional={includeProvisional} />)}
        </div>
      )}
    </>
  )
}

function ReportCard({ st, section, data, shown, includeProvisional }) {
  const s = useSchool()
  const termCount = s.year.term_count
  const periods = s.periods.slice(0, termCount)
  const q = (aid, pid) => data.quarterly.find((g) => g.student_id === st.id && g.assignment_id === aid && g.grading_period_id === pid)

  const rows = data.subjects.map(({ a, subject, config }) => {
    const terms = periods.map((p) => { const g = q(a.id, p.id); return shown(g) ? g.transmuted_grade : null })
    const anyProvisional = periods.some((p) => { const g = q(a.id, p.id); return g && shown(g) && !OFFICIAL.has(g.status) })
    const f = data.finals.find((x) => x.student_id === st.id && x.assignment_id === a.id)
    const counted = periodsForSemester(periods, a.semester, termCount)
    const finalShown = f && f.final_grade !== null && (OFFICIAL.has(f.status) || includeProvisional) && counted.every((p) => terms[periods.indexOf(p)] !== null)
    return { subject, semester: a.semester, passing: config?.passing_grade ?? 75, terms, final: finalShown ? f.final_grade : null, anyProvisional }
  })
  const general = computeGeneralAverage(rows.map((r) => r.final))
  const att = summarizeAttendance(data.attendance.filter((x) => x.student_id === st.id), s.settings)
  const provisional = rows.some((r) => r.anyProvisional || (r.final !== null && !OFFICIAL.has(data.finals.find((x) => x.student_id === st.id && x.assignment_id === data.subjects.find((z) => z.subject.id === r.subject.id)?.a.id)?.status)))
  const unverified = s.anyUnverified
  const adviser = section.adviser_id ? s.memberName(section.adviser_id) : ''

  return (
    <div className="report-card">
      {(provisional || unverified) && <div className="watermark">{provisional ? 'PROVISIONAL' : 'GRADING RULES NOT VERIFIED'}</div>}
      <h2>{s.school.name}</h2>
      <div className="rc-sub">{[s.school.address, s.school.division, s.school.region].filter(Boolean).join(' - ')}<br /><strong>Learner Progress Report</strong> - School Year {s.year.label}</div>
      <div className="rc-info">
        <span><strong>Name:</strong> {fullName(st)}</span>
        <span><strong>LRN:</strong> {st.lrn}</span>
        <span><strong>Grade and section:</strong> {s.sectionLabel(section.id)}</span>
        <span><strong>Adviser:</strong> {adviser || '-'}</span>
      </div>
      <table>
        <thead><tr><th style={{ textAlign: 'left' }}>Learning area</th>{periods.map((p) => <th key={p.id}>{p.name}</th>)}<th>Final grade</th><th>Remarks</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.subject.id}>
              <td style={{ textAlign: 'left' }}>{r.subject.name}{r.semester ? ` (${SEMESTER_LABELS[r.semester]})` : ''}</td>
              {r.terms.map((t, i) => <td key={i} style={{ textAlign: 'center' }}>{fmtGrade(t)}</td>)}
              <td style={{ textAlign: 'center' }}><strong>{fmtGrade(r.final)}</strong></td>
              <td style={{ textAlign: 'center' }}>{r.final === null ? '' : remarkFor(r.final, r.passing)}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={periods.length + 1} style={{ textAlign: 'right' }}><strong>General average</strong></td>
            <td style={{ textAlign: 'center' }}><strong>{fmtGrade(general)}</strong></td>
            <td style={{ textAlign: 'center' }}>{general === null ? '' : `${remarkFor(general)} - ${descriptorFor(general, s.descriptors)}`}</td>
          </tr>
        </tbody>
      </table>
      <p style={{ fontSize: 11 }}>A blank grade means it is not yet finalized or complete. It is not a zero.</p>
      <table>
        <thead><tr><th>Attendance (school year to date)</th><th>Present</th><th>Late</th><th>Absent</th><th>Excused</th></tr></thead>
        <tbody><tr><td style={{ textAlign: 'left' }}>Days recorded: {att.total}</td><td>{att.present}</td><td>{att.late}</td><td>{att.absent}</td><td>{att.excused}</td></tr></tbody>
      </table>
      <p style={{ fontSize: 11 }}><strong>Grade descriptors:</strong> {[...s.descriptors].sort((a, b) => b.min - a.min).map((d) => `${d.label} (${d.min}+)`).join('; ')}</p>
      <div className="rc-sign">
        <div>{adviser || ' '}<br />Class Adviser</div>
        {s.signatories.length ? s.signatories.map((x) => <div key={x.id}>{x.full_name || ' '}<br />{x.title}{x.position ? ` (${x.position})` : ''}</div>) : <div>&nbsp;<br />School Head</div>}
        <div>&nbsp;<br />Parent / Guardian</div>
      </div>
    </div>
  )
}

function Summary() {
  const s = useSchool()
  const { sections, section, setId } = useSectionPicker()
  const [periodId, setPeriodId] = useState('')
  const { data, loading, error } = useSectionGrades(section)
  const period = s.periods.find((p) => p.id === periodId) ?? s.periods[0]
  if (!section) return <div className="card"><EmptyState icon={FileText} title="No sections available" /></div>

  const cell = (stId, aid) => data.quarterly.find((g) => g.student_id === stId && g.assignment_id === aid && g.grading_period_id === period?.id)
  const avgRow = (stId) => {
    const g = data.subjects.map((x) => cell(stId, x.a.id))
    const vals = g.map((x) => (x?.transmuted_grade ?? null))
    return computeGeneralAverage(vals)
  }

  function exportCsv() {
    const head = ['LRN', 'Learner', ...data.subjects.map((x) => x.subject.name), `General average (${period.name})`, 'Status']
    const body = data.students.map((st) => {
      const gs = data.subjects.map((x) => cell(st.id, x.a.id))
      const status = gs.every((g) => g && OFFICIAL.has(g.status)) ? 'Finalized' : 'Provisional / incomplete'
      return [new ExcelText(st.lrn), fullName(st), ...gs.map((g) => g?.transmuted_grade ?? ''), avgRow(st.id) ?? '', status]
    })
    downloadCsv(`grade-summary-${s.sectionLabel(section.id)}-${period.name}.csv`.replace(/\s+/g, '_'), [head, ...body])
  }

  return (
    <>
      <div className="toolbar no-print">
        <Select value={section.id} onChange={setId} options={sections.map((x) => ({ value: x.id, label: s.sectionLabel(x.id) }))} aria-label="Section" />
        <Select value={period?.id} onChange={setPeriodId} options={s.periods.map((p) => ({ value: p.id, label: p.name }))} aria-label="Grading period" />
        <span className="grow" />
        <Button icon={Download} onClick={exportCsv} disabled={!data?.students.length}>Export CSV</Button>
        <Button icon={Printer} onClick={() => window.print()} disabled={!data?.students.length}>Print</Button>
      </div>
      <div className="spacer no-print" />
      {loading && !data ? <Loading /> : error ? <Alert type="danger">{error.message}</Alert> : (
        <div className="card sheet-print" style={{ display: 'block' }}>
          <PrintPage paper={s.settings?.default_paper} landscape margin="10mm" />
          <div className="card-pad">
            <h2>{s.school.name} - Class Grade Summary</h2>
            <p className="muted">{s.sectionLabel(section.id)} - {period?.name} - SY {s.year.label}. Blank = incomplete (never zero). Grades in red are below the passing grade.</p>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Learner</th>{data.subjects.map((x) => <th key={x.a.id}>{x.subject.name}</th>)}<th>Average</th></tr></thead>
              <tbody>
                {data.students.map((st) => (
                  <tr key={st.id}>
                    <td className="name"><strong>{fullName(st)}</strong></td>
                    {data.subjects.map((x) => {
                      const g = cell(st.id, x.a.id)
                      const v = g?.transmuted_grade ?? null
                      return <td key={x.a.id} className={v !== null && v < x.config?.passing_grade ? 'grade-fail' : ''}>{fmtGrade(v)}{v !== null && !OFFICIAL.has(g.status) ? <sup title="Provisional">p</sup> : null}</td>
                    })}
                    <td><strong>{fmtGrade(avgRow(st.id))}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small card-pad"><sup>p</sup> = provisional, not yet finalized.</p>
        </div>
      )}
    </>
  )
}

const PAGE = 25
function Audit() {
  const s = useSchool()
  const [page, setPage] = useState(0)
  const [table, setTable] = useState('')
  const { data, loading, error } = useAsync(async () => {
    let q = supabase.from('audit_logs').select('id,actor_id,action,table_name,record_id,created_at', { count: 'exact' }).eq('school_id', s.school.id)
    if (table) q = q.eq('table_name', table)
    const r = await q.order('created_at', { ascending: false }).order('id').range(page * PAGE, page * PAGE + PAGE - 1)
    if (r.error) throw r.error
    return { rows: r.data, total: r.count ?? 0 }
  }, [page, table, s.school.id])

  return (
    <div className="card">
      <div className="card-head">
        <h2><ScrollText size={18} style={{ verticalAlign: -3 }} /> Audit log</h2>
        <Select value={table} onChange={(v) => { setTable(v); setPage(0) }} placeholder="All tables" options={['scores', 'assessments', 'attendance', 'students', 'teacher_assignments', 'grading_configurations', 'transmutation_tables', 'quarterly_grades', 'school_memberships'].map((t) => ({ value: t, label: t }))} aria-label="Table" />
      </div>
      {loading && !data ? <Loading /> : error ? <div className="card-pad"><Alert type="danger">{error.message}</Alert></div> : data.rows.length === 0 ? <EmptyState icon={ScrollText} title="No audit entries" /> : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Table</th><th>Record</th></tr></thead>
              <tbody>{data.rows.map((r) => (
                <tr key={r.id}><td>{new Date(r.created_at).toLocaleString('en-PH')}</td><td>{r.actor_id ? s.memberName(r.actor_id) : <span className="muted">System</span>}</td>
                  <td><Badge tone={r.action === 'DELETE' ? 'danger' : r.action === 'INSERT' ? 'ok' : 'info'}>{r.action}</Badge></td><td className="mono">{r.table_name}</td><td className="mono small">{String(r.record_id ?? '').slice(0, 8)}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} />
        </>
      )}
    </div>
  )
}
