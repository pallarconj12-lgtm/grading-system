import { useEffect, useRef, useState } from 'react'
import { Plus, Trash2, RefreshCw, FlaskConical, Info, ImagePlus, Upload } from 'lucide-react'
import { supabase, fetchAll, unwrap } from '../lib/supabase.js'
import { useSchool } from '../context/SchoolContext.jsx'
import { useRunner } from '../lib/hooks.js'
import { Alert, Badge, Button, EmptyState, Field, PageHeader, Select, Tabs, VerifiedBadge } from '../components/ui.jsx'
import { ConfirmDialog, Modal } from '../components/Modal.jsx'
import { validateTransmutationRows, validateWeights } from '../lib/grading/index.js'
import { ROLE_LABELS } from '../lib/permissions.js'
import { logoUrl, saveLogo, removeLogo } from '../lib/schoolLogo.js'
import { SHS_DESCRIPTORS } from '../lib/semester.js'

export default function Settings() {
  const s = useSchool()
  const [tab, setTab] = useState('school')
  const admin = s.can('school.manage')
  const tabs = [
    { value: 'school', label: 'School' },
    { value: 'years', label: 'School years' },
    { value: 'grading', label: 'Grading rules' },
    { value: 'transmutation', label: 'Transmutation' },
    { value: 'options', label: 'Attendance and reports' },
    { value: 'users', label: 'Users and roles' },
  ]
  if (admin) tabs.push({ value: 'demo', label: 'Demo data' })
  return (
    <>
      <PageHeader title="Settings" subtitle="Everything here is saved to your school's database" />
      {!admin && <Alert type="info">Only administrators can change settings. You can view them.</Alert>}
      <div className="spacer" />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'school' && <SchoolTab admin={admin} />}
      {tab === 'years' && <YearsTab admin={admin} />}
      {tab === 'grading' && <GradingTab admin={admin} />}
      {tab === 'transmutation' && <TransmutationTab admin={admin} />}
      {tab === 'options' && <OptionsTab admin={admin} />}
      {tab === 'users' && <UsersTab admin={admin} />}
      {tab === 'demo' && <DemoTab />}
    </>
  )
}

/* ------------------------------------------------------------------ school */
function SchoolTab({ admin }) {
  const s = useSchool()
  const { busy, run } = useRunner()
  const [f, setF] = useState({ name: s.school.name ?? '', school_code: s.school.school_code ?? '', division: s.school.division ?? '', region: s.school.region ?? '', address: s.school.address ?? '' })
  const [error, setError] = useState('')
  const fileRef = useRef(null)
  const url = logoUrl(s.school.logo_path)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  async function pickLogo(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    const r = await run(() => saveLogo(s.school, file), 'School logo saved.')
    if (r.ok) s.reload()
  }
  async function dropLogo() {
    setError('')
    const r = await run(() => removeLogo(s.school), 'School logo removed.')
    if (r.ok) s.reload()
  }
  async function save() {
    if (!f.name.trim()) return setError('Enter the school name.')
    setError('')
    const payload = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || null]))
    payload.name = f.name.trim()
    const r = await run(async () => unwrap(await supabase.from('schools').update(payload).eq('id', s.school.id)), 'School details saved.')
    if (r.ok) s.reload()
  }
  return (
    <div className="card card-pad stack" style={{ maxWidth: 720 }}>
      <h2>School details</h2>
      {error && <Alert type="danger">{error}</Alert>}
      <div className="logo-upload">
        <div className="logo-preview">{url ? <img src={url} alt="School logo" /> : <ImagePlus size={26} aria-hidden />}</div>
        <div className="stack" style={{ gap: 8 }}>
          <strong>School logo</strong>
          <span className="muted small">PNG, JPG or WebP. It is resized automatically and shown before your school name.</span>
          {admin && (
            <div className="row">
              <Button icon={Upload} onClick={() => fileRef.current?.click()} disabled={busy}>{url ? 'Change logo' : 'Upload logo'}</Button>
              {url && <Button variant="ghost" icon={Trash2} onClick={dropLogo} disabled={busy}>Remove</Button>}
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={pickLogo} />
            </div>
          )}
        </div>
      </div>
      <div className="form-grid">
        <Field label="School name" className="full"><input className="input" value={f.name} onChange={set('name')} disabled={!admin} /></Field>
        <Field label="School ID / code"><input className="input" value={f.school_code} onChange={set('school_code')} disabled={!admin} /></Field>
        <Field label="Schools division"><input className="input" value={f.division} onChange={set('division')} disabled={!admin} /></Field>
        <Field label="Region"><input className="input" value={f.region} onChange={set('region')} disabled={!admin} /></Field>
        <Field label="Address" className="full"><input className="input" value={f.address} onChange={set('address')} disabled={!admin} /></Field>
      </div>
      {admin && <div><Button variant="primary" onClick={save} disabled={busy}>Save school details</Button></div>}
    </div>
  )
}

/* ------------------------------------------------------------------- years */
function YearsTab({ admin }) {
  const s = useSchool()
  const { busy, run } = useRunner()
  const [form, setForm] = useState(false)
  const [periodDraft, setPeriodDraft] = useState({})

  async function makeCurrent(y) {
    const r = await run(async () => {
      unwrap(await supabase.from('academic_years').update({ is_current: false }).eq('school_id', s.school.id).eq('is_current', true))
      unwrap(await supabase.from('academic_years').update({ is_current: true }).eq('id', y.id))
    }, `${y.label} is now the current school year.`)
    if (r.ok) s.reload()
  }
  async function savePeriod(p) {
    const d = periodDraft[p.id]
    if (!d) return
    const payload = { name: (d.name ?? p.name).trim(), start_date: (d.start_date ?? p.start_date) || null, end_date: (d.end_date ?? p.end_date) || null }
    if (!payload.name) return
    const r = await run(async () => unwrap(await supabase.from('grading_periods').update(payload).eq('id', p.id)), 'Period saved.')
    if (r.ok) { setPeriodDraft(({ [p.id]: _, ...rest }) => rest); s.reload() }
  }
  const setP = (p, k) => (e) => setPeriodDraft((d) => ({ ...d, [p.id]: { ...d[p.id], [k]: e.target.value } }))

  return (
    <div className="stack">
      <div className="row between">
        <p className="muted">The school year decides which sections, classes and grading periods you see.</p>
        {admin && <Button variant="primary" icon={Plus} onClick={() => setForm(true)}>Add school year</Button>}
      </div>
      {s.years.map((y) => {
        const periods = s.allPeriods.filter((p) => p.academic_year_id === y.id).sort((a, b) => a.term_no - b.term_no)
        return (
          <div className="card" key={y.id}>
            <div className="card-head">
              <h2>SY {y.label} {y.is_current && <Badge tone="ok">Current</Badge>}</h2>
              <div className="row"><Badge>{y.term_count === 3 ? '3 terms' : '4 quarters'}</Badge>{admin && !y.is_current && <Button size="sm" onClick={() => makeCurrent(y)} disabled={busy}>Make current</Button>}</div>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Period</th><th>Starts</th><th>Ends</th><th /></tr></thead>
                <tbody>{periods.map((p) => (
                  <tr key={p.id}>
                    <td><input className="input" value={periodDraft[p.id]?.name ?? p.name} onChange={setP(p, 'name')} disabled={!admin} aria-label="Period name" /></td>
                    <td><input className="input" type="date" value={periodDraft[p.id]?.start_date ?? p.start_date ?? ''} onChange={setP(p, 'start_date')} disabled={!admin} aria-label="Start date" /></td>
                    <td><input className="input" type="date" value={periodDraft[p.id]?.end_date ?? p.end_date ?? ''} onChange={setP(p, 'end_date')} disabled={!admin} aria-label="End date" /></td>
                    <td className="actions">{admin && <Button size="sm" onClick={() => savePeriod(p)} disabled={busy || !periodDraft[p.id]}>Save</Button>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )
      })}
      {form && <YearForm onClose={() => setForm(false)} />}
    </div>
  )
}

function YearForm({ onClose }) {
  const s = useSchool()
  const { busy, run } = useRunner()
  const y = new Date().getFullYear()
  const [f, setF] = useState({ label: `${y}-${y + 1}`, start_date: `${y}-06-01`, end_date: `${y + 1}-03-31`, term_count: '3' })
  const [error, setError] = useState('')
  async function save() {
    if (!f.label.trim()) return setError('Enter a label such as 2026-2027.')
    if (f.start_date && f.end_date && f.start_date > f.end_date) return setError('The start date is after the end date.')
    const n = Number(f.term_count)
    const r = await run(async () => {
      const year = unwrap(await supabase.from('academic_years').insert({ school_id: s.school.id, label: f.label.trim(), start_date: f.start_date || null, end_date: f.end_date || null, term_count: n }).select('id').single())
      unwrap(await supabase.from('grading_periods').insert(Array.from({ length: n }, (_, i) => ({ school_id: s.school.id, academic_year_id: year.id, term_no: i + 1, name: `${n === 3 ? 'Term' : 'Quarter'} ${i + 1}` }))))
    }, 'School year added.')
    if (r.ok) { s.reload(); onClose() }
  }
  return (
    <Modal title="Add school year" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={busy}>Add</Button></>}>
      <div className="stack">
        {error && <Alert type="danger">{error}</Alert>}
        <div className="form-grid">
          <Field label="Label"><input className="input" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></Field>
          <Field label="Grading periods" help="Confirm the number against the guidelines your school follows."><Select value={f.term_count} onChange={(v) => setF({ ...f, term_count: v })} options={[{ value: '3', label: '3 terms' }, { value: '4', label: '4 quarters' }]} /></Field>
          <Field label="Starts"><input className="input" type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field>
          <Field label="Ends"><input className="input" type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></Field>
        </div>
        <Alert type="info">The number of periods cannot be changed after grades are recorded, so choose carefully.</Alert>
      </div>
    </Modal>
  )
}

/* ----------------------------------------------------------------- grading */
function GradingTab({ admin }) {
  const s = useSchool()
  const [form, setForm] = useState(null)
  const usedBy = (c) => s.subjects.filter((x) => x.grading_configuration_id === c.id).map((x) => x.name)
  return (
    <div className="stack">
      <Alert type="warn"><strong>Verify before relying on these rules.</strong> The defaults were prepared from published summaries of DepEd Order No. 015, s. 2026, not from the official text. Compare each value with the official issuance, then mark it verified. Changing any value clears the verification and recomputes the affected grades.</Alert>
      <div className="row between"><p className="muted">A grading configuration sets component weights, the missing-score policy and which transmutation table applies.</p>{admin && <Button variant="primary" icon={Plus} onClick={() => setForm({ config: null })}>New configuration</Button>}</div>
      <div className="card"><div className="table-wrap"><table className="table">
        <thead><tr><th>Name</th><th>WW / PT / QA</th><th>Transmutation</th><th>Missing scores</th><th>Used by</th><th>Status</th><th /></tr></thead>
        <tbody>{s.configs.map((c) => (
          <tr key={c.id}>
            <td><strong>{c.name}</strong><span className="muted small" style={{ display: 'block' }}>{c.policy_source ? `${c.policy_source.slice(0, 70)}${c.policy_source.length > 70 ? '...' : ''}` : 'No source recorded'}{c.policy_version ? ` (${c.policy_version})` : ''}</span></td>
            <td className="mono">{c.ww_weight} / {c.pt_weight} / {c.qa_weight}</td>
            <td>{c.transmutation_mode === 'zero_based' ? 'None (zero-based)' : s.tables.find((t) => t.id === c.transmutation_table_id)?.name ?? '-'}</td>
            <td>{c.missing_policy === 'block' ? 'Block finalizing' : 'Exclude and flag'}</td>
            <td className="small">{usedBy(c).join(', ') || <span className="muted">No subjects</span>}</td>
            <td><VerifiedBadge verified={c.is_verified} /></td>
            <td className="actions"><Button size="sm" onClick={() => setForm({ config: c })}>{admin ? 'Edit' : 'View'}</Button></td>
          </tr>
        ))}</tbody></table></div></div>
      {form && <ConfigForm config={form.config} admin={admin} onClose={() => setForm(null)} />}
    </div>
  )
}

function ConfigForm({ config, admin, onClose }) {
  const s = useSchool()
  const { busy, run } = useRunner()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [f, setF] = useState({
    name: config?.name ?? '', policy_source: config?.policy_source ?? '', policy_version: config?.policy_version ?? '',
    ww_weight: config?.ww_weight ?? 30, pt_weight: config?.pt_weight ?? 50, qa_weight: config?.qa_weight ?? 20,
    missing_policy: config?.missing_policy ?? 'exclude_flag', transmutation_mode: config?.transmutation_mode ?? 'table',
    transmutation_table_id: config?.transmutation_table_id ?? s.tables[0]?.id ?? '', passing_grade: config?.passing_grade ?? 75,
    minimum_reportable_grade: config?.minimum_reportable_grade ?? 60, initial_decimals: config?.initial_decimals ?? 2, is_verified: config?.is_verified ?? false,
  })
  const [errors, setErrors] = useState([])
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const total = Number(f.ww_weight) + Number(f.pt_weight) + Number(f.qa_weight)

  async function save() {
    const errs = []
    if (!f.name.trim()) errs.push('Enter a name.')
    errs.push(...validateWeights(f.ww_weight, f.pt_weight, f.qa_weight).errors)
    if (f.transmutation_mode === 'table' && !f.transmutation_table_id) errs.push('Choose a transmutation table, or switch to zero-based.')
    setErrors(errs)
    if (errs.length) return
    const payload = {
      name: f.name.trim(), policy_source: f.policy_source.trim(), policy_version: f.policy_version.trim(),
      ww_weight: Number(f.ww_weight), pt_weight: Number(f.pt_weight), qa_weight: Number(f.qa_weight),
      missing_policy: f.missing_policy, transmutation_mode: f.transmutation_mode,
      transmutation_table_id: f.transmutation_mode === 'table' ? f.transmutation_table_id : null,
      passing_grade: Number(f.passing_grade), minimum_reportable_grade: Number(f.minimum_reportable_grade), initial_decimals: Number(f.initial_decimals),
      is_verified: Boolean(f.is_verified),
    }
    const r = await run(async () => {
      if (config) unwrap(await supabase.from('grading_configurations').update(payload).eq('id', config.id))
      else unwrap(await supabase.from('grading_configurations').insert({ ...payload, school_id: s.school.id }))
    }, config ? 'Configuration saved. Affected grades were recomputed.' : 'Configuration created.')
    if (r.ok) { s.reload(); onClose() }
  }
  async function remove() {
    const r = await run(async () => unwrap(await supabase.from('grading_configurations').delete().eq('id', config.id)), 'Configuration deleted.')
    if (r.ok) { s.reload(); onClose() }
  }
  const d = !admin

  return (
    <>
      <Modal title={config ? 'Grading configuration' : 'New grading configuration'} size="wide" onClose={onClose}
        footer={<>{admin && config && <Button variant="danger" onClick={() => setConfirmDelete(true)} disabled={busy}>Delete</Button>}<span className="grow" /><Button onClick={onClose}>{admin ? 'Cancel' : 'Close'}</Button>{admin && <Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Saving...' : 'Save'}</Button>}</>}>
        <div className="stack">
          {errors.length > 0 && <Alert type="danger"><ul style={{ margin: 0, paddingLeft: 18 }}>{errors.map((e) => <li key={e}>{e}</li>)}</ul></Alert>}
          <div className="form-grid">
            <Field label="Name" className="full"><input className="input" value={f.name} onChange={set('name')} disabled={d} /></Field>
            <Field label="Policy source" className="full" help="The issuance this was taken from."><input className="input" value={f.policy_source} onChange={set('policy_source')} disabled={d} /></Field>
            <Field label="Policy version / date"><input className="input" value={f.policy_version} onChange={set('policy_version')} disabled={d} /></Field>
            <Field label="Passing grade"><input className="input" inputMode="numeric" value={f.passing_grade} onChange={set('passing_grade')} disabled={d} /></Field>
          </div>
          <div>
            <h3 style={{ marginBottom: 6 }}>Component weights <Badge tone={total === 100 ? 'ok' : 'danger'}>Total {Number.isNaN(total) ? '?' : total}%</Badge></h3>
            <div className="form-grid">
              <Field label="Written Works %"><input className="input" inputMode="decimal" value={f.ww_weight} onChange={set('ww_weight')} disabled={d} /></Field>
              <Field label="Performance Tasks %"><input className="input" inputMode="decimal" value={f.pt_weight} onChange={set('pt_weight')} disabled={d} /></Field>
              <Field label="Quarterly Assessment %"><input className="input" inputMode="decimal" value={f.qa_weight} onChange={set('qa_weight')} disabled={d} /></Field>
            </div>
          </div>
          <div className="form-grid">
            <Field label="Transmutation"><Select value={f.transmutation_mode} onChange={(v) => setF((x) => ({ ...x, transmutation_mode: v }))} disabled={d} options={[{ value: 'table', label: 'Use a transmutation table' }, { value: 'zero_based', label: 'None: zero-based (initial grade is the grade)' }]} /></Field>
            {f.transmutation_mode === 'table' && <Field label="Transmutation table"><Select value={f.transmutation_table_id} onChange={(v) => setF((x) => ({ ...x, transmutation_table_id: v }))} disabled={d} placeholder="Choose..." options={s.tables.map((t) => ({ value: t.id, label: `${t.name}${t.is_verified ? '' : ' (not verified)'}` }))} /></Field>}
            <Field label="When scores are missing" help="Missing scores are never counted as zero."><Select value={f.missing_policy} onChange={(v) => setF((x) => ({ ...x, missing_policy: v }))} disabled={d} options={[{ value: 'exclude_flag', label: 'Exclude from the grade and flag as incomplete' }, { value: 'block', label: 'Block finalizing until entered' }]} /></Field>
            <Field label="Lowest reportable grade"><input className="input" inputMode="numeric" value={f.minimum_reportable_grade} onChange={set('minimum_reportable_grade')} disabled={d} /></Field>
            <Field label="Initial grade decimals"><input className="input" inputMode="numeric" value={f.initial_decimals} onChange={set('initial_decimals')} disabled={d} /></Field>
          </div>
          {admin && <label className="check"><input type="checkbox" checked={f.is_verified} onChange={(e) => setF((x) => ({ ...x, is_verified: e.target.checked }))} /> I compared these values with the official issuance and they match.</label>}
          {config?.is_verified && config.verified_at && <p className="muted small">Verified on {new Date(config.verified_at).toLocaleDateString('en-PH')}{config.verified_by ? ` by ${s.memberName(config.verified_by)}` : ''}.</p>}
        </div>
      </Modal>
      {confirmDelete && <ConfirmDialog danger title="Delete configuration?" message={<p>Delete <strong>{config.name}</strong>? A configuration still used by a subject cannot be deleted.</p>} confirmLabel="Delete" busy={busy} onConfirm={remove} onCancel={() => setConfirmDelete(false)} />}
    </>
  )
}

/* ------------------------------------------------------------ transmutation */
function TransmutationTab({ admin }) {
  const s = useSchool()
  const { busy, run } = useRunner()
  const [tableId, setTableId] = useState('')
  const table = s.tables.find((t) => t.id === tableId) ?? s.tables[0]
  const [rows, setRows] = useState(null)
  const [meta, setMeta] = useState({})
  const [result, setResult] = useState(null)
  const [verify, setVerify] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')

  useEffect(() => {
    if (!table) return
    let live = true
    setRows(null); setResult(null)
    setMeta({ policy_source: table.policy_source, policy_version: table.policy_version, notes: table.notes })
    setVerify(table.is_verified)
    fetchAll(() => supabase.from('transmutation_rows').select('min_initial,max_initial,transmuted').eq('table_id', table.id).order('min_initial'))
      .then((r) => live && setRows(r.map((x) => ({ min_initial: String(x.min_initial), max_initial: String(x.max_initial), transmuted: String(x.transmuted) }))))
      .catch((e) => live && setResult({ errors: [e.message] }))
    return () => { live = false }
  }, [table?.id, table?.is_verified]) // eslint-disable-line

  if (!table) return <div className="card"><EmptyState icon={Info} title="No transmutation tables">{admin && <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Create one</Button>}</EmptyState>{creating && <NewTable name={name} setName={setName} onClose={() => setCreating(false)} />}</div>

  const setCell = (i, k) => (e) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)))
  const check = () => { const v = validateTransmutationRows(rows); setResult(v); return v }

  async function save() {
    const v = check()
    if (!v.valid) return
    const payload = rows.map((r) => ({ min_initial: Number(r.min_initial), max_initial: Number(r.max_initial), transmuted: Number(r.transmuted) }))
    const r = await run(async () => {
      unwrap(await supabase.rpc('replace_transmutation_rows', { p_table: table.id, p_rows: payload }))
      unwrap(await supabase.from('transmutation_tables').update({ policy_source: meta.policy_source ?? '', policy_version: meta.policy_version ?? '', notes: meta.notes ?? '', is_verified: Boolean(verify) }).eq('id', table.id))
    }, 'Transmutation table saved. Affected grades were recomputed.')
    if (r.ok) s.reload()
  }

  return (
    <div className="stack">
      <Alert type="warn">Transmutation converts an initial grade to the reported grade through a lookup table. It is <strong>not</strong> a formula, and nothing here is assumed to match the official table until you verify it against the issuance. Saving a changed table clears its verification and recomputes grades.</Alert>
      <div className="toolbar">
        <Select value={table.id} onChange={setTableId} options={s.tables.map((t) => ({ value: t.id, label: `${t.name}${t.is_verified ? '' : ' (not verified)'}` }))} aria-label="Table" />
        <VerifiedBadge verified={table.is_verified} />
        <span className="grow" />
        {admin && <Button icon={Plus} onClick={() => setCreating(true)}>New table</Button>}
      </div>
      <div className="card card-pad stack">
        <div className="form-grid">
          <Field label="Policy source" className="full"><input className="input" value={meta.policy_source ?? ''} onChange={(e) => setMeta((m) => ({ ...m, policy_source: e.target.value }))} disabled={!admin} /></Field>
          <Field label="Version / date"><input className="input" value={meta.policy_version ?? ''} onChange={(e) => setMeta((m) => ({ ...m, policy_version: e.target.value }))} disabled={!admin} /></Field>
          <Field label="Notes"><input className="input" value={meta.notes ?? ''} onChange={(e) => setMeta((m) => ({ ...m, notes: e.target.value }))} disabled={!admin} /></Field>
        </div>
        {result && (result.valid ? <Alert type="ok">The table is valid: it starts at 0, ends at 100, and has no gaps, overlaps or decreasing grades.</Alert> : <Alert type="danger"><ul style={{ margin: 0, paddingLeft: 18 }}>{result.errors.map((e) => <li key={e}>{e}</li>)}</ul></Alert>)}
        {rows === null ? <p className="muted">Loading rows...</p> : (
          <div className="table-wrap" style={{ maxHeight: 420, overflow: 'auto' }}>
            <table className="table">
              <thead><tr><th>From initial grade</th><th>To initial grade</th><th>Transmuted grade</th><th /></tr></thead>
              <tbody>{rows.map((r, i) => (
                <tr key={i}>
                  <td><input className="input" inputMode="decimal" value={r.min_initial} onChange={setCell(i, 'min_initial')} disabled={!admin} aria-label={`Row ${i + 1} from`} /></td>
                  <td><input className="input" inputMode="decimal" value={r.max_initial} onChange={setCell(i, 'max_initial')} disabled={!admin} aria-label={`Row ${i + 1} to`} /></td>
                  <td><input className="input" inputMode="numeric" value={r.transmuted} onChange={setCell(i, 'transmuted')} disabled={!admin} aria-label={`Row ${i + 1} grade`} /></td>
                  <td className="actions">{admin && <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Remove row ${i + 1}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} />}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {admin && rows && (
          <>
            <div className="row">
              <Button icon={Plus} onClick={() => setRows((rs) => [...rs, { min_initial: '', max_initial: '', transmuted: '' }])}>Add row</Button>
              <Button onClick={check}>Check table</Button>
            </div>
            <label className="check"><input type="checkbox" checked={verify} onChange={(e) => setVerify(e.target.checked)} /> I compared every row with the official table and they match.</label>
            <div><Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Saving...' : 'Save table'}</Button></div>
          </>
        )}
      </div>
      {creating && <NewTable name={name} setName={setName} onClose={() => setCreating(false)} onDone={(id) => setTableId(id)} />}
    </div>
  )
}

function NewTable({ name, setName, onClose, onDone }) {
  const s = useSchool()
  const { busy, run } = useRunner()
  async function create() {
    if (!name.trim()) return
    const r = await run(async () => {
      const t = unwrap(await supabase.from('transmutation_tables').insert({ school_id: s.school.id, name: name.trim() }).select('id').single())
      unwrap(await supabase.rpc('replace_transmutation_rows', { p_table: t.id, p_rows: [{ min_initial: 0, max_initial: 49.99, transmuted: 60 }, { min_initial: 50, max_initial: 100, transmuted: 100 }] }))
      return t.id
    }, 'Table created with two placeholder rows. Replace them with the official values.')
    if (r.ok) { s.reload(); onDone?.(r.result); setName(''); onClose() }
  }
  return (
    <Modal title="New transmutation table" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={create} disabled={busy || !name.trim()}>Create</Button></>}>
      <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
    </Modal>
  )
}

/* ----------------------------------------------------------------- options */
function OptionsTab({ admin }) {
  const s = useSchool()
  const { busy, run } = useRunner()
  const st = s.settings ?? {}
  const [f, setF] = useState({ late: st.late_counts_as_present ?? true, excused: st.excused_counts_as_present ?? false, paper: st.default_paper ?? 'A4' })
  const [desc, setDesc] = useState(s.descriptors.map((d) => ({ min: String(d.min), label: d.label })))
  const [sigs, setSigs] = useState(s.signatories.map((x) => ({ ...x })))
  const [errors, setErrors] = useState([])

  async function saveOptions() {
    const errs = []
    const cleaned = desc.map((d) => ({ min: Number(d.min), label: d.label.trim() }))
    if (cleaned.some((d) => Number.isNaN(d.min) || d.min < 0 || d.min > 100 || !d.label)) errs.push('Each descriptor needs a label and a minimum grade from 0 to 100.')
    if (!cleaned.some((d) => d.min === 0)) errs.push('Include a descriptor that starts at 0 so every grade has a descriptor.')
    setErrors(errs)
    if (errs.length) return
    const r = await run(async () => unwrap(await supabase.from('school_settings').upsert({ school_id: s.school.id, late_counts_as_present: f.late, excused_counts_as_present: f.excused, default_paper: f.paper, descriptors: cleaned }, { onConflict: 'school_id' })), 'Settings saved.')
    if (r.ok) s.reload()
  }
  async function saveSig(x) {
    if (!x.title.trim()) return
    const payload = { title: x.title.trim(), full_name: x.full_name.trim(), position: x.position.trim(), sort_order: x.sort_order ?? sigs.length }
    const r = await run(async () => (x.id ? unwrap(await supabase.from('report_signatories').update(payload).eq('id', x.id)) : unwrap(await supabase.from('report_signatories').insert({ ...payload, school_id: s.school.id }))), 'Signatory saved.')
    if (r.ok) s.reload()
  }
  async function removeSig(x, i) {
    if (!x.id) return setSigs((l) => l.filter((_, j) => j !== i))
    const r = await run(async () => unwrap(await supabase.from('report_signatories').delete().eq('id', x.id)), 'Signatory removed.')
    if (r.ok) { setSigs((l) => l.filter((_, j) => j !== i)); s.reload() }
  }
  const upSig = (i, k) => (e) => setSigs((l) => l.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))

  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <div className="card card-pad stack">
        <h2>Attendance and printing</h2>
        {errors.length > 0 && <Alert type="danger"><ul style={{ margin: 0, paddingLeft: 18 }}>{errors.map((e) => <li key={e}>{e}</li>)}</ul></Alert>}
        <label className="check"><input type="checkbox" checked={f.late} disabled={!admin} onChange={(e) => setF({ ...f, late: e.target.checked })} /> Count late learners as present in the attendance rate</label>
        <label className="check"><input type="checkbox" checked={f.excused} disabled={!admin} onChange={(e) => setF({ ...f, excused: e.target.checked })} /> Count excused learners as present in the attendance rate</label>
        <Field label="Default paper size"><Select value={f.paper} disabled={!admin} onChange={(v) => setF({ ...f, paper: v })} options={['A4', 'Letter', 'Legal'].map((p) => ({ value: p, label: p }))} /></Field>
        <h3>Grade descriptors</h3>
        <p className="muted small">Shown on report cards. Confirm the bands and wording against the DepEd Order your school follows.</p>
        {desc.map((d, i) => (
          <div className="row" key={i}>
            <input className="input" style={{ width: 90 }} inputMode="numeric" value={d.min} disabled={!admin} onChange={(e) => setDesc((l) => l.map((x, j) => (j === i ? { ...x, min: e.target.value } : x)))} aria-label="Minimum grade" />
            <input className="input" style={{ flex: 1, minWidth: 0 }} value={d.label} disabled={!admin} onChange={(e) => setDesc((l) => l.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} aria-label="Descriptor" />
            {admin && <Button size="sm" variant="ghost" icon={Trash2} aria-label="Remove descriptor" onClick={() => setDesc((l) => l.filter((_, j) => j !== i))} />}
          </div>
        ))}
        {admin && <div className="row"><Button icon={Plus} onClick={() => setDesc((l) => [...l, { min: '', label: '' }])}>Add descriptor</Button><Button onClick={() => setDesc(SHS_DESCRIPTORS.map((d) => ({ ...d })))}>Use SHS descriptors</Button><Button variant="primary" onClick={saveOptions} disabled={busy}>Save settings</Button></div>}
      </div>
      <div className="card card-pad stack">
        <h2>Report card signatories</h2>
        <p className="muted small">Printed under the adviser's line on report cards.</p>
        {sigs.map((x, i) => (
          <div className="form-grid" key={x.id ?? `n${i}`} style={{ alignItems: 'end' }}>
            <Field label="Title"><input className="input" value={x.title} onChange={upSig(i, 'title')} disabled={!admin} /></Field>
            <Field label="Name"><input className="input" value={x.full_name} onChange={upSig(i, 'full_name')} disabled={!admin} /></Field>
            <Field label="Position"><input className="input" value={x.position} onChange={upSig(i, 'position')} disabled={!admin} /></Field>
            {admin && <div className="row"><Button size="sm" variant="primary" onClick={() => saveSig(x)} disabled={busy}>Save</Button><Button size="sm" variant="ghost" icon={Trash2} aria-label="Remove signatory" onClick={() => removeSig(x, i)} /></div>}
          </div>
        ))}
        {admin && <div><Button icon={Plus} onClick={() => setSigs((l) => [...l, { title: '', full_name: '', position: '' }])}>Add signatory</Button></div>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------- users */
function UsersTab({ admin }) {
  const s = useSchool()
  const { busy, run } = useRunner()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('teacher')
  const [remove, setRemove] = useState(null)
  const admins = s.members.filter((m) => m.role === 'admin').length

  async function add() {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return
    const r = await run(async () => unwrap(await supabase.rpc('add_member_by_email', { p_school: s.school.id, p_email: email.trim(), p_role: role })), 'Member added.')
    if (r.ok) { setEmail(''); s.reload() }
  }
  async function changeRole(m, next) {
    const r = await run(async () => unwrap(await supabase.from('school_memberships').update({ role: next }).eq('id', m.id)), 'Role updated.')
    if (r.ok) s.reload()
  }
  async function doRemove() {
    const r = await run(async () => unwrap(await supabase.from('school_memberships').delete().eq('id', remove.id)), 'Member removed.')
    setRemove(null)
    if (r.ok) s.reload()
  }

  return (
    <div className="stack">
      {admin && (
        <div className="card card-pad stack">
          <h2>Add a person</h2>
          <p className="muted small">The person must first create an account on the sign-in page. Then add them here by their e-mail address.</p>
          <div className="row">
            <input className="input" style={{ maxWidth: 300 }} type="email" placeholder="name@school.edu.ph" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="E-mail address" />
            <Select value={role} onChange={setRole} options={Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }))} aria-label="Role" />
            <Button variant="primary" icon={Plus} onClick={add} disabled={busy || !email.trim()}>Add</Button>
          </div>
        </div>
      )}
      <div className="card"><div className="table-wrap"><table className="table">
        <thead><tr><th>Name</th><th>E-mail</th><th>Role</th><th /></tr></thead>
        <tbody>{s.members.map((m) => (
          <tr key={m.id}>
            <td>{m.profiles?.full_name || '-'}{m.user_id === s.user.id && <Badge>You</Badge>}</td>
            <td>{m.profiles?.email}</td>
            <td>{admin && m.user_id !== s.user.id ? <Select value={m.role} onChange={(v) => changeRole(m, v)} options={Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }))} aria-label={`Role of ${m.profiles?.email}`} /> : ROLE_LABELS[m.role]}</td>
            <td className="actions">{admin && m.user_id !== s.user.id && !(m.role === 'admin' && admins <= 1) && <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Remove ${m.profiles?.email}`} onClick={() => setRemove(m)} />}</td>
          </tr>
        ))}</tbody></table></div></div>
      <Alert type="info">Administrators manage everything. Teachers enter grades and attendance for their own classes. School heads and reviewers can view all grades and approve finalized terms.</Alert>
      {remove && <ConfirmDialog danger title="Remove this person?" message={<p>Remove <strong>{remove.profiles?.email}</strong> from {s.school.name}? Their account stays, but they lose access to this school's records.</p>} confirmLabel="Remove" busy={busy} onConfirm={doRemove} onCancel={() => setRemove(null)} />}
    </div>
  )
}

/* -------------------------------------------------------------------- demo */
function DemoTab() {
  const s = useSchool()
  const { busy, run } = useRunner()
  const [confirm, setConfirm] = useState(null)
  const call = (fn, msg) => async () => {
    const r = await run(async () => unwrap(await supabase.rpc(fn, { p_school: s.school.id })), msg)
    setConfirm(null)
    if (r.ok) s.reload()
  }
  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <div className="card card-pad stack">
        <h2><FlaskConical size={18} style={{ verticalAlign: -3 }} /> Demo data</h2>
        <p className="muted">Load a small set of <strong>fictional</strong> learners, two demo sections, assessments and attendance so you can try every feature. Demo records are labeled and can be removed in one step without touching your real records. Do not enter real learner information while demo data is loaded for training.</p>
        <div className="row">
          <Button icon={FlaskConical} onClick={() => setConfirm({ title: 'Load demo data?', message: <p>This adds fictional learners and classes to <strong>{s.school.name}</strong>. Your existing records are not changed.</p>, label: 'Load demo data', run: call('seed_demo_data', 'Demo data loaded.') })}>Load demo data</Button>
          <Button variant="danger" icon={Trash2} onClick={() => setConfirm({ title: 'Remove demo data?', message: <p>Removes every demo learner, section and score. Real records are kept.</p>, label: 'Remove demo data', danger: true, run: call('remove_demo_data', 'Demo data removed.') })}>Remove demo data</Button>
        </div>
      </div>
      <div className="card card-pad stack">
        <h2>Recompute all grades</h2>
        <p className="muted">Grades recompute automatically whenever scores or rules change. Run this only if you want to force a full refresh.</p>
        <div><Button icon={RefreshCw} disabled={busy} onClick={() => setConfirm({ title: 'Recompute every grade?', message: <p>Recalculates grades for every class and term with the current rules. Locked (finalized) terms stay locked.</p>, label: 'Recompute', run: async () => { const r = await run(async () => unwrap(await supabase.rpc('recompute_school_grades', { p_school: s.school.id }))); setConfirm(null); if (r.ok) s.reload() } })}>Recompute all grades</Button></div>
      </div>
      {confirm && <ConfirmDialog title={confirm.title} message={confirm.message} danger={confirm.danger} confirmLabel={confirm.label} busy={busy} onConfirm={confirm.run} onCancel={() => setConfirm(null)} />}
    </div>
  )
}
