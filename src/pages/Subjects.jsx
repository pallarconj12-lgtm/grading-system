import { useState } from 'react'
import { Plus, Pencil, Trash2, BookOpen, ClipboardList } from 'lucide-react'
import { supabase, unwrap } from '../lib/supabase.js'
import { useSchool } from '../context/SchoolContext.jsx'
import { useRunner } from '../lib/hooks.js'
import { Alert, Badge, Button, EmptyState, Field, PageHeader, Select, Tabs, VerifiedBadge } from '../components/ui.jsx'
import { ConfirmDialog, Modal } from '../components/Modal.jsx'

export default function Subjects() {
  const [tab, setTab] = useState('subjects')
  const s = useSchool()
  return (
    <>
      <PageHeader title="Subjects" subtitle="Learning areas, their grading components, and who teaches what" />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'subjects', label: 'Subjects' }, { value: 'assignments', label: `Teacher assignments (${s.year?.label ?? ''})` }]} />
      {tab === 'subjects' ? <SubjectsTab /> : <AssignmentsTab />}
    </>
  )
}

function SubjectsTab() {
  const s = useSchool()
  const { busy, run } = useRunner()
  const [form, setForm] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const manage = s.can('subjects.manage')
  const cfgName = (id) => s.configs.find((c) => c.id === id)

  async function remove(sub) {
    const r = await run(async () => unwrap(await supabase.from('subjects').delete().eq('id', sub.id)), 'Subject deleted.')
    if (r.ok) s.reload()
    setConfirm(null)
  }

  return (
    <>
      <div className="row between" style={{ marginBottom: 14 }}>
        <p className="muted">Each subject uses a grading configuration that sets its component weights and transmutation rules. Schools do not all offer the same subjects.</p>
        {manage && <Button variant="primary" icon={Plus} onClick={() => setForm({ subject: null })}>Add subject</Button>}
      </div>
      <div className="card">
        {s.subjects.length === 0 ? <EmptyState icon={BookOpen} title="No subjects yet" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Subject</th><th>Learning area</th><th>Grading configuration</th><th>Weights WW / PT / QA</th><th>Status</th><th /></tr></thead>
              <tbody>
                {s.subjects.map((sub) => {
                  const c = cfgName(sub.grading_configuration_id)
                  return (
                    <tr key={sub.id}>
                      <td><strong>{sub.name}</strong>{sub.code && <span className="muted small"> ({sub.code})</span>}</td>
                      <td>{sub.learning_area ?? '-'}</td>
                      <td>{c?.name} <VerifiedBadge verified={c?.is_verified} /></td>
                      <td className="mono">{c ? `${c.ww_weight} / ${c.pt_weight} / ${c.qa_weight}` : '-'}</td>
                      <td>{sub.is_active ? <Badge tone="ok">Active</Badge> : <Badge tone="muted">Inactive</Badge>}</td>
                      <td className="actions">
                        {manage && <Button size="sm" variant="ghost" icon={Pencil} aria-label={`Edit ${sub.name}`} onClick={() => setForm({ subject: sub })} />}
                        {manage && <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Delete ${sub.name}`}
                          onClick={() => setConfirm({ title: 'Delete subject?', message: <p>Delete <strong>{sub.name}</strong>? Subjects already assigned to a class cannot be deleted; mark them inactive instead.</p>, run: () => remove(sub) })} />}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {form && <SubjectForm subject={form.subject} onClose={() => setForm(null)} />}
      {confirm && <ConfirmDialog danger title={confirm.title} message={confirm.message} confirmLabel="Delete" busy={busy} onConfirm={confirm.run} onCancel={() => setConfirm(null)} />}
    </>
  )
}

function SubjectForm({ subject, onClose }) {
  const s = useSchool()
  const { busy, run } = useRunner()
  const [f, setF] = useState({
    name: subject?.name ?? '', code: subject?.code ?? '', learning_area: subject?.learning_area ?? '',
    grading_configuration_id: subject?.grading_configuration_id ?? s.configs[0]?.id ?? '', is_active: subject?.is_active ?? true,
  })
  const [error, setError] = useState('')
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))

  async function save() {
    if (!f.name.trim()) return setError('Enter the subject name.')
    if (!f.grading_configuration_id) return setError('Choose a grading configuration (create one in Settings first).')
    const payload = { name: f.name.trim(), code: f.code.trim() || null, learning_area: f.learning_area.trim() || null, grading_configuration_id: f.grading_configuration_id, is_active: f.is_active }
    const r = await run(async () => {
      if (subject) unwrap(await supabase.from('subjects').update(payload).eq('id', subject.id))
      else unwrap(await supabase.from('subjects').insert({ ...payload, school_id: s.school.id, sort_order: s.subjects.length + 1 }))
    }, subject ? 'Subject updated.' : 'Subject added.')
    if (r.ok) { s.reload(); onClose() }
  }

  return (
    <Modal title={subject ? 'Edit subject' : 'Add subject'} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Saving...' : 'Save'}</Button></>}>
      <div className="stack">
        {error && <Alert type="danger">{error}</Alert>}
        <div className="form-grid">
          <Field label="Subject name" className="full"><input className="input" value={f.name} onChange={set('name')} /></Field>
          <Field label="Code (optional)"><input className="input" value={f.code} onChange={set('code')} /></Field>
          <Field label="Learning area (optional)"><input className="input" value={f.learning_area} onChange={set('learning_area')} /></Field>
          <Field label="Grading configuration" className="full" help="Sets the WW / PT / QA weights, the missing-score policy and the transmutation rules.">
            <Select value={f.grading_configuration_id} onChange={(v) => setF((x) => ({ ...x, grading_configuration_id: v }))}
              options={s.configs.map((c) => ({ value: c.id, label: `${c.name}${c.is_verified ? '' : ' (not verified)'}` }))} />
          </Field>
          <label className="check full"><input type="checkbox" checked={f.is_active} onChange={(e) => setF((x) => ({ ...x, is_active: e.target.checked }))} /> Active (offered this year)</label>
        </div>
      </div>
    </Modal>
  )
}

function AssignmentsTab() {
  const s = useSchool()
  const { busy, run } = useRunner()
  const [form, setForm] = useState(false)
  const [confirm, setConfirm] = useState(null)
  const manage = s.can('assignments.manage')
  const subj = (id) => s.subjects.find((x) => x.id === id)?.name ?? ''
  const rows = [...s.yearAssignments].sort((a, b) => s.sectionLabel(a.section_id).localeCompare(s.sectionLabel(b.section_id)) || subj(a.subject_id).localeCompare(subj(b.subject_id)))

  async function remove(a) {
    const r = await run(async () => unwrap(await supabase.from('teacher_assignments').delete().eq('id', a.id)), 'Assignment removed.')
    if (r.ok) s.reload()
    setConfirm(null)
  }

  return (
    <>
      <div className="row between" style={{ marginBottom: 14 }}>
        <p className="muted">A teacher can open the gradebook and attendance only for the sections and subjects assigned here.</p>
        {manage && <Button variant="primary" icon={Plus} onClick={() => setForm(true)} disabled={s.yearSections.length === 0}>Assign teacher</Button>}
      </div>
      <div className="card">
        {rows.length === 0 ? <EmptyState icon={ClipboardList} title="No assignments yet">{s.yearSections.length === 0 ? 'Create sections first.' : 'Assign a teacher to a section and subject.'}</EmptyState> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Section</th><th>Subject</th><th>Teacher</th><th /></tr></thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td>{s.sectionLabel(a.section_id)}</td><td>{subj(a.subject_id)}</td><td>{s.memberName(a.teacher_id)}</td>
                    <td className="actions">
                      {manage && <Button size="sm" variant="ghost" icon={Trash2} aria-label="Remove assignment"
                        onClick={() => setConfirm({ title: 'Remove this assignment?', message: <p>Removing <strong>{subj(a.subject_id)}</strong> for <strong>{s.sectionLabel(a.section_id)}</strong> also permanently deletes every assessment, score and computed grade recorded for that class. Archive or reassign instead if you only want to change the teacher.</p>, run: () => remove(a) })} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {form && <AssignmentForm onClose={() => setForm(false)} />}
      {confirm && <ConfirmDialog danger title={confirm.title} message={confirm.message} confirmLabel="Remove and delete grades" busy={busy} onConfirm={confirm.run} onCancel={() => setConfirm(null)} />}
    </>
  )
}

function AssignmentForm({ onClose }) {
  const s = useSchool()
  const { busy, run } = useRunner()
  const [f, setF] = useState({ section_id: s.yearSections[0]?.id ?? '', subject_id: '', teacher_id: '' })
  const [error, setError] = useState('')
  const teachers = s.members.filter((m) => m.role === 'teacher' || m.role === 'admin')
  const taken = new Set(s.yearAssignments.filter((a) => a.section_id === f.section_id).map((a) => a.subject_id))

  async function save() {
    if (!f.section_id || !f.subject_id || !f.teacher_id) return setError('Choose a section, a subject and a teacher.')
    const r = await run(async () => unwrap(await supabase.from('teacher_assignments').insert({ ...f, school_id: s.school.id, academic_year_id: s.year.id })), 'Teacher assigned.')
    if (r.ok) { s.reload(); onClose() }
  }

  return (
    <Modal title="Assign teacher" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Saving...' : 'Assign'}</Button></>}>
      <div className="stack">
        {error && <Alert type="danger">{error}</Alert>}
        <Field label="Section"><Select value={f.section_id} onChange={(v) => setF((x) => ({ ...x, section_id: v, subject_id: '' }))} options={s.yearSections.map((x) => ({ value: x.id, label: s.sectionLabel(x.id) }))} /></Field>
        <Field label="Subject"><Select value={f.subject_id} onChange={(v) => setF((x) => ({ ...x, subject_id: v }))} placeholder="Choose..." options={s.subjects.filter((x) => x.is_active).map((x) => ({ value: x.id, label: x.name + (taken.has(x.id) ? ' (already assigned)' : ''), disabled: taken.has(x.id) }))} /></Field>
        <Field label="Teacher" help="Teachers must be added under Settings, Users and roles first."><Select value={f.teacher_id} onChange={(v) => setF((x) => ({ ...x, teacher_id: v }))} placeholder="Choose..." options={teachers.map((m) => ({ value: m.user_id, label: m.profiles?.full_name || m.profiles?.email }))} /></Field>
      </div>
    </Modal>
  )
}
