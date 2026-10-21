import { useState } from 'react'
import { Plus, Pencil, Trash2, Layers } from 'lucide-react'
import { supabase, unwrap } from '../lib/supabase.js'
import { useSchool } from '../context/SchoolContext.jsx'
import { useRunner } from '../lib/hooks.js'
import { isSeniorHighLevel } from '../lib/semester.js'
import { Alert, Button, EmptyState, Field, PageHeader, Select, Tabs } from '../components/ui.jsx'
import { ConfirmDialog, Modal } from '../components/Modal.jsx'

export default function Sections() {
  const [tab, setTab] = useState('sections')
  return (
    <>
      <PageHeader title="Sections" subtitle="Class sections and grade levels" />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'sections', label: 'Sections' }, { value: 'levels', label: 'Grade levels' }]} />
      {tab === 'sections' ? <SectionsTab /> : <LevelsTab />}
    </>
  )
}

function SectionsTab() {
  const s = useSchool()
  const { busy, run } = useRunner()
  const [form, setForm] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const manage = s.can('sections.manage')
  const rows = [...s.yearSections].sort((a, b) => s.levelName(a.grade_level_id).localeCompare(s.levelName(b.grade_level_id)) || a.name.localeCompare(b.name))

  async function remove(sec) {
    const r = await run(async () => unwrap(await supabase.from('sections').delete().eq('id', sec.id)), 'Section deleted.')
    if (r.ok) s.reload()
    setConfirm(null)
  }

  return (
    <>
      <div className="row between" style={{ marginBottom: 14 }}>
        <p className="muted">Sections for school year <strong>{s.year?.label}</strong>. {!manage && 'You see only the sections you teach or advise.'}</p>
        {manage && <Button variant="primary" icon={Plus} onClick={() => setForm({ section: null })} disabled={!s.year}>Add section</Button>}
      </div>
      <div className="card">
        {rows.length === 0 ? <EmptyState icon={Layers} title="No sections" action={manage && s.year ? <Button variant="primary" icon={Plus} onClick={() => setForm({ section: null })}>Add section</Button> : null}>
          {manage ? 'Create your first section to start adding learners.' : 'No sections are assigned to you yet.'}
        </EmptyState> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Grade level</th><th>Strand</th><th>Section</th><th>Adviser</th><th>Classes</th><th /></tr></thead>
              <tbody>
                {rows.map((sec) => (
                  <tr key={sec.id}>
                    <td>{s.levelName(sec.grade_level_id)}</td>
                    <td>{sec.strand || <span className="muted">-</span>}</td>
                    <td><strong>{sec.name}</strong></td>
                    <td>{sec.adviser_id ? s.memberName(sec.adviser_id) : <span className="muted">None</span>}</td>
                    <td>{s.yearAssignments.filter((a) => a.section_id === sec.id).length} subject(s)</td>
                    <td className="actions">
                      {manage && <Button size="sm" variant="ghost" icon={Pencil} aria-label={`Edit ${sec.name}`} onClick={() => setForm({ section: sec })} />}
                      {manage && <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Delete ${sec.name}`}
                        onClick={() => setConfirm({ title: 'Delete section?', message: <p>Delete <strong>{s.levelName(sec.grade_level_id)} - {sec.name}</strong>? Sections that still have learners cannot be deleted. Its subject assignments, assessments and scores will be removed.</p>, run: () => remove(sec) })} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {form && <SectionForm section={form.section} onClose={() => setForm(null)} />}
      {confirm && <ConfirmDialog danger title={confirm.title} message={confirm.message} confirmLabel="Delete" busy={busy} onConfirm={confirm.run} onCancel={() => setConfirm(null)} />}
    </>
  )
}

function SectionForm({ section, onClose }) {
  const s = useSchool()
  const { busy, run } = useRunner()
  const [f, setF] = useState({ name: section?.name ?? '', grade_level_id: section?.grade_level_id ?? s.levels[0]?.id ?? '', adviser_id: section?.adviser_id ?? '', strand: section?.strand ?? '' })
  const [error, setError] = useState('')

  async function save() {
    if (!f.name.trim()) return setError('Enter the section name.')
    const shs = isSeniorHighLevel(s.levels.find((l) => l.id === f.grade_level_id)?.level)
    const payload = { name: f.name.trim(), grade_level_id: f.grade_level_id, adviser_id: f.adviser_id || null, strand: shs && f.strand.trim() ? f.strand.trim() : null }
    const r = await run(async () => {
      if (section) unwrap(await supabase.from('sections').update(payload).eq('id', section.id))
      else unwrap(await supabase.from('sections').insert({ ...payload, school_id: s.school.id, academic_year_id: s.year.id }))
    }, section ? 'Section updated.' : 'Section added.')
    if (r.ok) { s.reload(); onClose() }
  }

  return (
    <Modal title={section ? 'Edit section' : 'Add section'} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Saving...' : 'Save'}</Button></>}>
      <div className="stack">
        {error && <Alert type="danger">{error}</Alert>}
        <Field label="Grade level"><Select value={f.grade_level_id} onChange={(v) => setF((x) => ({ ...x, grade_level_id: v }))} options={s.levels.map((l) => ({ value: l.id, label: l.name }))} disabled={Boolean(section)} /></Field>
        {isSeniorHighLevel(s.levels.find((l) => l.id === f.grade_level_id)?.level) && (
          <Field label="Strand (optional)" help="For example STEM, ABM, HUMSS, GAS or TVL."><input className="input" maxLength={40} value={f.strand} onChange={(e) => setF((x) => ({ ...x, strand: e.target.value }))} /></Field>
        )}
        <Field label="Section name"><input className="input" value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} /></Field>
        <Field label="Class adviser (optional)" help="Advisers can view their section's learners, attendance and grades."><Select value={f.adviser_id} onChange={(v) => setF((x) => ({ ...x, adviser_id: v }))} placeholder="No adviser" options={s.members.map((m) => ({ value: m.user_id, label: m.profiles?.full_name || m.profiles?.email }))} /></Field>
      </div>
    </Modal>
  )
}

function LevelsTab() {
  const s = useSchool()
  const { busy, run } = useRunner()
  const [names, setNames] = useState(() => Object.fromEntries(s.levels.map((l) => [l.id, l.name])))
  const manage = s.can('sections.manage')

  async function save(l) {
    const name = names[l.id]?.trim()
    if (!name) return
    const r = await run(async () => unwrap(await supabase.from('grade_levels').update({ name }).eq('id', l.id)), `${name} saved.`)
    if (r.ok) s.reload()
  }

  return (
    <div className="card">
      <div className="card-head"><h2>Grade levels</h2><span className="muted small">Junior and Senior High School, Grades 7 to 12</span></div>
      <div className="card-pad stack">
        {s.levels.map((l) => (
          <div key={l.id} className="row">
            <span className="badge" style={{ minWidth: 70, justifyContent: 'center' }}>Level {l.level}</span>
            <input className="input" style={{ maxWidth: 280 }} value={names[l.id] ?? ''} onChange={(e) => setNames((n) => ({ ...n, [l.id]: e.target.value }))} disabled={!manage} aria-label={`Display name for level ${l.level}`} />
            {manage && <Button size="sm" onClick={() => save(l)} disabled={busy || names[l.id] === l.name}>Save</Button>}
          </div>
        ))}
      </div>
    </div>
  )
}
