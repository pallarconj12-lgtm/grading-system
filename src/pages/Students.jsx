import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Pencil, Trash2, Archive, ArchiveRestore, Eye, Upload, Download, Users } from 'lucide-react'
import { supabase, fetchAll, unwrap } from '../lib/supabase.js'
import { useSchool } from '../context/SchoolContext.jsx'
import { useAsync, useDebounced, useRunner } from '../lib/hooks.js'
import { Alert, Badge, Button, EmptyState, Field, Loading, PageHeader, Pager, SearchBox, Select } from '../components/ui.jsx'
import { ConfirmDialog, Modal } from '../components/Modal.jsx'
import { validateStudent } from '../lib/grading/index.js'
import { ExcelText, downloadCsv, parseCsvObjects, readFileText, toCsv, downloadFile } from '../lib/csv.js'
import { ENROLLMENT_LABELS, fullName } from '../lib/format.js'

const PAGE_SIZE = 25
const STATUS_OPTIONS = Object.entries(ENROLLMENT_LABELS).map(([value, label]) => ({ value, label }))
const statusTone = { enrolled: 'ok', transferred_out: 'info', dropped: 'warn', archived: 'muted' }

export default function Students() {
  const s = useSchool()
  const { busy, run } = useRunner()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const [levelId, setLevelId] = useState('')
  const [sectionId, setSectionId] = useState('')
  const [status, setStatus] = useState('enrolled')
  const [page, setPage] = useState(0)
  const [refresh, setRefresh] = useState(0)
  const [form, setForm] = useState(null) // { student|null }
  const [view, setView] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [importing, setImporting] = useState(false)

  const canWrite = s.can('students.write')
  const sectionOptions = s.yearSections.filter((x) => !levelId || x.grade_level_id === levelId)

  useEffect(() => {
    if (params.get('add') === '1' && canWrite) {
      setForm({ student: null })
      setParams({}, { replace: true })
    }
  }, [params, canWrite, setParams])

  useEffect(() => setPage(0), [dq, levelId, sectionId, status, s.year?.id])

  const applyFilters = (query) => {
    let x = query.eq('school_id', s.school.id).eq('academic_year_id', s.year.id)
    if (levelId) x = x.eq('grade_level_id', levelId)
    if (sectionId) x = x.eq('section_id', sectionId)
    if (status) x = x.eq('status', status)
    const term = dq.trim().replace(/[,()*%\\]/g, ' ').trim()
    if (term) x = x.or(`lrn.ilike.%${term}%,last_name.ilike.%${term}%,first_name.ilike.%${term}%`)
    return x
  }
  const ordered = (x) => x.order('last_name').order('first_name').order('id')

  const { data, loading, error } = useAsync(
    async () => {
      const r = await ordered(applyFilters(supabase.from('students').select('*', { count: 'exact' }))).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      if (r.error) throw r.error
      return { rows: r.data, count: r.count ?? 0 }
    },
    [s.school.id, s.year?.id, levelId, sectionId, status, dq, page, refresh],
    { enabled: Boolean(s.year) },
  )

  const sectionName = (id) => s.sectionLabel(id)
  const reload = () => setRefresh((n) => n + 1)

  async function setStatusOf(student, next) {
    const r = await run(async () => unwrap(await supabase.from('students').update({ status: next }).eq('id', student.id)), next === 'archived' ? 'Learner archived.' : 'Learner restored.')
    if (r.ok) reload()
    setConfirm(null)
  }

  async function remove(student) {
    const r = await run(async () => unwrap(await supabase.from('students').delete().eq('id', student.id)), 'Learner deleted.')
    if (r.ok) reload()
    setConfirm(null)
  }

  async function exportCsv() {
    const r = await run(async () => {
      const rows = await fetchAll(() => ordered(applyFilters(supabase.from('students').select('*'))))
      const out = [['LRN', 'First Name', 'Middle Name', 'Last Name', 'Suffix', 'Sex', 'Grade Level', 'Section', 'School Year', 'Status']]
      for (const x of rows) {
        const sec = s.sections.find((z) => z.id === x.section_id)
        out.push([new ExcelText(x.lrn), x.first_name, x.middle_name, x.last_name, x.suffix, x.sex, s.levelName(x.grade_level_id), sec?.name, s.year.label, ENROLLMENT_LABELS[x.status]])
      }
      downloadCsv(`students-${s.year.label}.csv`, out)
      return rows.length
    })
    if (r.ok) return r.result
  }

  return (
    <>
      <PageHeader title="Students" subtitle={`${s.year?.label ?? ''} - search, filter and manage learner records`}>
        <Button icon={Download} onClick={exportCsv} disabled={busy}>Export CSV</Button>
        {canWrite && <Button icon={Upload} onClick={() => setImporting(true)}>Import CSV</Button>}
        {canWrite && <Button variant="primary" icon={Plus} onClick={() => setForm({ student: null })} disabled={s.yearSections.length === 0}>Add student</Button>}
      </PageHeader>

      {s.yearSections.length === 0 && (
        <Alert type="info">
          {s.can('sections.manage') ? 'Create a section first (Sections page), then add learners.' : 'You have no sections assigned yet. Ask your administrator to assign you to a section.'}
        </Alert>
      )}
      <div className="spacer" />

      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="Search by name or LRN" />
        <Select value={levelId} onChange={(v) => { setLevelId(v); setSectionId('') }} placeholder="All grade levels" options={s.levels.map((l) => ({ value: l.id, label: l.name }))} aria-label="Grade level" />
        <Select value={sectionId} onChange={setSectionId} placeholder="All sections" options={sectionOptions.map((x) => ({ value: x.id, label: `${s.levelName(x.grade_level_id)} - ${x.name}` }))} aria-label="Section" />
        <Select value={status} onChange={setStatus} placeholder="All statuses" options={STATUS_OPTIONS} aria-label="Enrollment status" />
      </div>

      <div className="card">
        {loading && !data ? <Loading /> : error ? (
          <div className="card-pad"><Alert type="danger">{error.message}</Alert></div>
        ) : data.rows.length === 0 ? (
          <EmptyState icon={Users} title="No learners found" action={canWrite && s.yearSections.length > 0 ? <Button variant="primary" icon={Plus} onClick={() => setForm({ student: null })}>Add student</Button> : null}>
            {q || levelId || sectionId ? 'Try changing your search or filters.' : 'Add learners one by one or import a CSV file.'}
          </EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>LRN</th><th>Name</th><th>Grade and section</th><th>Sex</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {data.rows.map((st) => (
                    <tr key={st.id}>
                      <td className="mono">{st.lrn}</td>
                      <td><strong>{fullName(st)}</strong></td>
                      <td>{sectionName(st.section_id)}</td>
                      <td>{st.sex ?? '-'}</td>
                      <td><Badge tone={statusTone[st.status]}>{ENROLLMENT_LABELS[st.status]}</Badge></td>
                      <td className="actions">
                        <Button size="sm" variant="ghost" icon={Eye} onClick={() => setView(st)} aria-label={`View ${fullName(st)}`} />
                        {canWrite && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setForm({ student: st })} aria-label={`Edit ${fullName(st)}`} />}
                        {canWrite && (st.status === 'archived'
                          ? <Button size="sm" variant="ghost" icon={ArchiveRestore} aria-label={`Restore ${fullName(st)}`} onClick={() => setStatusOf(st, 'enrolled')} />
                          : <Button size="sm" variant="ghost" icon={Archive} aria-label={`Archive ${fullName(st)}`}
                              onClick={() => setConfirm({ title: 'Archive learner?', message: <p><strong>{fullName(st)}</strong> will be hidden from class lists but all grades and attendance are kept. You can restore them later.</p>, label: 'Archive', run: () => setStatusOf(st, 'archived') })} />)}
                        {s.can('students.delete') && <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Delete ${fullName(st)}`}
                          onClick={() => setConfirm({ danger: true, title: 'Delete learner permanently?', message: <p>This permanently removes <strong>{fullName(st)}</strong> together with all of their scores, grades and attendance. This cannot be undone. Consider archiving instead.</p>, label: 'Delete permanently', run: () => remove(st) })} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} pageSize={PAGE_SIZE} total={data.count} onPage={setPage} />
          </>
        )}
      </div>

      {form && <StudentForm student={form.student} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload() }} />}
      {view && <StudentView student={view} onClose={() => setView(null)} />}
      {importing && <ImportModal onClose={() => setImporting(false)} onDone={reload} />}
      {confirm && <ConfirmDialog title={confirm.title} message={confirm.message} danger={confirm.danger} confirmLabel={confirm.label} busy={busy} onConfirm={confirm.run} onCancel={() => setConfirm(null)} />}
    </>
  )
}

function StudentView({ student, onClose }) {
  const s = useSchool()
  const rows = [
    ['LRN', student.lrn], ['Full name', fullName(student, { lastFirst: false })], ['Sex', student.sex ?? '-'],
    ['Grade and section', s.sectionLabel(student.section_id)], ['School year', s.year.label], ['Enrollment status', ENROLLMENT_LABELS[student.status]],
  ]
  return (
    <Modal title="Learner record" onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      <dl className="stack" style={{ margin: 0 }}>
        {rows.map(([k, v]) => (
          <div key={k} className="row between" style={{ borderBottom: '1px solid var(--sage-100)', paddingBottom: 8 }}>
            <dt className="muted">{k}</dt><dd style={{ margin: 0, fontWeight: 600 }}>{v}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  )
}

function StudentForm({ student, onClose, onSaved }) {
  const s = useSchool()
  const { busy, run } = useRunner()
  const editing = Boolean(student)
  const firstSection = s.yearSections[0]
  const [f, setF] = useState({
    lrn: student?.lrn ?? '', first_name: student?.first_name ?? '', middle_name: student?.middle_name ?? '',
    last_name: student?.last_name ?? '', suffix: student?.suffix ?? '', sex: student?.sex ?? '',
    grade_level_id: student?.grade_level_id ?? firstSection?.grade_level_id ?? '',
    section_id: student?.section_id ?? firstSection?.id ?? '',
    status: student?.status ?? 'enrolled',
  })
  const [errors, setErrors] = useState([])
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const sections = s.yearSections.filter((x) => x.grade_level_id === f.grade_level_id)
  const levels = s.levels.filter((l) => s.yearSections.some((x) => x.grade_level_id === l.id))

  async function save() {
    const v = validateStudent(f)
    const errs = [...v.errors]
    if (!f.section_id) errs.push('Choose a section.')
    setErrors(errs)
    if (errs.length) return
    const payload = { ...v.clean, grade_level_id: f.grade_level_id, section_id: f.section_id, status: f.status }
    const r = await run(async () => {
      if (editing) unwrap(await supabase.from('students').update(payload).eq('id', student.id))
      else unwrap(await supabase.from('students').insert({ ...payload, school_id: s.school.id, academic_year_id: s.year.id }))
    }, editing ? 'Learner updated.' : 'Learner added.')
    if (r.ok) onSaved()
  }

  return (
    <Modal title={editing ? 'Edit learner' : 'Add learner'} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Saving...' : 'Save'}</Button></>}>
      <div className="stack">
        {errors.length > 0 && <Alert type="danger"><ul style={{ margin: 0, paddingLeft: 18 }}>{errors.map((e) => <li key={e}>{e}</li>)}</ul></Alert>}
        <div className="form-grid">
          <Field label="Learner Reference Number (LRN)" help="12 digits" className="full"><input className="input mono" inputMode="numeric" maxLength={12} value={f.lrn} onChange={set('lrn')} /></Field>
          <Field label="First name"><input className="input" value={f.first_name} onChange={set('first_name')} /></Field>
          <Field label="Middle name"><input className="input" value={f.middle_name} onChange={set('middle_name')} /></Field>
          <Field label="Last name"><input className="input" value={f.last_name} onChange={set('last_name')} /></Field>
          <Field label="Suffix" help="Jr., III, etc. (optional)"><input className="input" value={f.suffix} onChange={set('suffix')} /></Field>
          <Field label="Sex"><Select value={f.sex} onChange={(v) => setF((x) => ({ ...x, sex: v }))} placeholder="Not specified" options={[{ value: 'Male', label: 'Male' }, { value: 'Female', label: 'Female' }]} /></Field>
          <Field label="Enrollment status"><Select value={f.status} onChange={(v) => setF((x) => ({ ...x, status: v }))} options={STATUS_OPTIONS} /></Field>
          <Field label="Grade level">
            <Select value={f.grade_level_id} onChange={(v) => setF((x) => ({ ...x, grade_level_id: v, section_id: s.yearSections.find((y) => y.grade_level_id === v)?.id ?? '' }))} options={levels.map((l) => ({ value: l.id, label: l.name }))} />
          </Field>
          <Field label="Section"><Select value={f.section_id} onChange={(v) => setF((x) => ({ ...x, section_id: v }))} placeholder="Choose..." options={sections.map((x) => ({ value: x.id, label: x.name }))} /></Field>
        </div>
        <p className="muted small">School year: {s.year.label}. Collect only the information the school needs (Data Privacy Act of 2012).</p>
      </div>
    </Modal>
  )
}

const IMPORT_COLUMNS = ['lrn', 'first_name', 'middle_name', 'last_name', 'suffix', 'sex', 'grade_level', 'section']

function ImportModal({ onClose, onDone }) {
  const s = useSchool()
  const { busy, run } = useRunner()
  const [plan, setPlan] = useState(null)
  const [result, setResult] = useState(null)
  const [fileError, setFileError] = useState('')

  async function onFile(file) {
    setFileError('')
    setResult(null)
    if (!file) return
    try {
      const { headers, records } = parseCsvObjects(await readFileText(file))
      const missing = ['lrn', 'first_name', 'last_name', 'grade_level', 'section'].filter((h) => !headers.includes(h))
      if (missing.length) return setFileError(`The file is missing these columns: ${missing.join(', ')}. Download the template to see the expected columns.`)
      if (records.length === 0) return setFileError('The file has no learner rows.')
      if (records.length > 2000) return setFileError('Import at most 2000 rows at a time.')

      const seen = new Set()
      const rows = records.map((rec) => {
        const v = validateStudent(rec)
        const errs = [...v.errors]
        const lvlNum = Number(String(rec.grade_level).match(/\d+/)?.[0])
        const level = s.levels.find((l) => l.level === lvlNum)
        const section = level && s.yearSections.find((x) => x.grade_level_id === level.id && x.name.toLowerCase() === String(rec.section).trim().toLowerCase())
        if (!level) errs.push('Grade level must be 7 to 10.')
        else if (!section) errs.push(`Section "${rec.section}" does not exist for ${level.name} this year (or you cannot access it).`)
        if (v.clean.lrn && seen.has(v.clean.lrn)) errs.push('Duplicate LRN inside the file.')
        seen.add(v.clean.lrn)
        return { line: rec.__line, clean: v.clean, level, section, errors: errs }
      })

      // LRNs that already exist this year
      const lrns = rows.filter((r) => r.clean.lrn).map((r) => r.clean.lrn)
      const existing = new Set()
      for (let i = 0; i < lrns.length; i += 100) {
        const r = await supabase.from('students').select('lrn').eq('academic_year_id', s.year.id).in('lrn', lrns.slice(i, i + 100))
        if (r.error) throw r.error
        r.data.forEach((x) => existing.add(x.lrn))
      }
      rows.forEach((r) => { if (existing.has(r.clean.lrn)) r.errors.push('A learner with this LRN already exists this year.') })
      setPlan(rows)
    } catch (e) {
      setFileError(e.message)
    }
  }

  const good = plan?.filter((r) => r.errors.length === 0) ?? []

  async function doImport() {
    const r = await run(async () => {
      let ok = 0
      const failed = []
      const toRow = (r) => ({ ...r.clean, school_id: s.school.id, academic_year_id: s.year.id, grade_level_id: r.level.id, section_id: r.section.id, status: 'enrolled' })
      for (let i = 0; i < good.length; i += 100) {
        const chunk = good.slice(i, i + 100)
        const bulk = await supabase.from('students').insert(chunk.map(toRow))
        if (!bulk.error) { ok += chunk.length; continue }
        for (const row of chunk) { // isolate the failing row(s)
          const one = await supabase.from('students').insert(toRow(row))
          if (one.error) failed.push({ line: row.line, message: one.error.message })
          else ok += 1
        }
      }
      return { ok, failed }
    })
    if (r.ok) { setResult(r.result); onDone() }
  }

  function template() {
    downloadFile('students-template.csv', toCsv([IMPORT_COLUMNS, ['900000000001', 'Juan', 'Santos', 'Dela Cruz', '', 'Male', '7', s.yearSections[0]?.name ?? 'Narra']]))
  }

  return (
    <Modal title="Import learners from CSV" size="wide" onClose={onClose}
      footer={result ? <Button variant="primary" onClick={onClose}>Done</Button> : <><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={doImport} disabled={busy || good.length === 0}>{busy ? 'Importing...' : `Import ${good.length} learner${good.length === 1 ? '' : 's'}`}</Button></>}>
      <div className="stack">
        <p className="muted">Columns: <code>{IMPORT_COLUMNS.join(', ')}</code>. LRNs must be 12 digits. Sections must already exist for the selected school year. Rows with problems are skipped, never partly imported.</p>
        <div className="row">
          <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} aria-label="CSV file" />
          <Button size="sm" icon={Download} onClick={template}>Download template</Button>
        </div>
        {fileError && <Alert type="danger">{fileError}</Alert>}
        {result && (
          <Alert type={result.failed.length ? 'warn' : 'ok'}>
            Imported {result.ok} learner{result.ok === 1 ? '' : 's'}.
            {result.failed.map((f) => <div key={f.line}>Line {f.line}: {f.message}</div>)}
          </Alert>
        )}
        {plan && !result && (
          <>
            <p><Badge tone="ok">{good.length} ready</Badge> {plan.length - good.length > 0 && <Badge tone="danger">{plan.length - good.length} with problems</Badge>}</p>
            <div className="table-wrap" style={{ maxHeight: 320 }}>
              <table className="table">
                <thead><tr><th>Line</th><th>LRN</th><th>Name</th><th>Section</th><th>Result</th></tr></thead>
                <tbody>
                  {plan.map((r) => (
                    <tr key={r.line}>
                      <td>{r.line}</td><td className="mono">{r.clean.lrn}</td><td>{fullName(r.clean)}</td>
                      <td>{r.section ? `${r.level.name} - ${r.section.name}` : '-'}</td>
                      <td>{r.errors.length ? <span className="grade-fail small">{r.errors.join(' ')}</span> : <Badge tone="ok">OK</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
