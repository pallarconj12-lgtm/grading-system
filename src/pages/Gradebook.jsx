import { useEffect, useMemo, useState } from 'react'
import {
  Plus, Pencil, Printer, Download, Upload, Lock, Unlock, ShieldCheck, CheckCircle2, Table2, Loader2, Info,
} from 'lucide-react'
import { supabase, fetchAll, unwrap, friendlyError } from '../lib/supabase.js'
import { useSchool } from '../context/SchoolContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useAsync, useBeforeUnload, useRunner } from '../lib/hooks.js'
import { Alert, Badge, Button, EmptyState, Field, Loading, PageHeader, Select, StatusBadge, VerifiedBadge } from '../components/ui.jsx'
import { ConfirmDialog, Modal } from '../components/Modal.jsx'
import PrintPage from '../components/PrintPage.jsx'
import { COMPONENTS, COMPONENT_LABELS, computeTermGrade, parseScoreInput, remarkFor, normalizeLrn } from '../lib/grading/index.js'
import { ExcelText, downloadCsv, parseCsv, readFileText } from '../lib/csv.js'
import { canEditAssignment } from '../lib/permissions.js'
import { fmtDate, fmtGrade, fmtNum, fmtPct, fullName } from '../lib/format.js'

const keyOf = (aid, sid) => `${aid}:${sid}`
const display = (row) => (!row ? '' : row.is_excused ? 'X' : row.score === null || row.score === undefined ? '' : String(row.score))

export default function Gradebook() {
  const s = useSchool()
  const toast = useToast()
  const { busy, run } = useRunner()
  const [sel, setSel] = useState({ level: '', section: '', assignment: '', period: '' })
  const [scoreMap, setScoreMap] = useState({})
  const [pending, setPending] = useState(0)
  const [reloadKey, setReloadKey] = useState(0)
  const [assessmentForm, setAssessmentForm] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [importing, setImporting] = useState(false)

  // ----- resolve the selection to one class (assignment) and one term -----
  const avail = useMemo(
    () => s.yearAssignments.map((a) => ({ a, sec: s.sections.find((x) => x.id === a.section_id) })).filter((x) => x.sec),
    [s.yearAssignments, s.sections],
  )
  const levelOpts = s.levels.filter((l) => avail.some((x) => x.sec.grade_level_id === l.id))
  const levelId = levelOpts.some((l) => l.id === sel.level) ? sel.level : levelOpts[0]?.id
  const sectionOpts = [...new Map(avail.filter((x) => x.sec.grade_level_id === levelId).map((x) => [x.sec.id, x.sec])).values()].sort((a, b) => a.name.localeCompare(b.name))
  const sectionId = sectionOpts.some((x) => x.id === sel.section) ? sel.section : sectionOpts[0]?.id
  const subjOpts = avail.filter((x) => x.sec.id === sectionId).map((x) => ({ ...x, subject: s.subjects.find((z) => z.id === x.a.subject_id) })).sort((a, b) => (a.subject?.sort_order ?? 0) - (b.subject?.sort_order ?? 0))
  const assignment = (subjOpts.find((x) => x.a.id === sel.assignment) ?? subjOpts[0])?.a
  const subject = s.subjects.find((x) => x.id === assignment?.subject_id)
  const config = s.configs.find((c) => c.id === subject?.grading_configuration_id)
  const period = s.periods.find((p) => p.id === sel.period) ?? s.periods[0]
  const section = s.sections.find((x) => x.id === assignment?.section_id)
  const canEdit = assignment ? canEditAssignment({ role: s.role, userId: s.user.id, assignment }) && s.can('scores.write') : false

  // ----- load everything for this class and term -----
  const { data, loading, error } = useAsync(
    async () => {
      const [students, assessments, grades] = await Promise.all([
        fetchAll(() => supabase.from('students').select('*').eq('section_id', assignment.section_id).eq('status', 'enrolled').order('last_name').order('first_name').order('id')),
        fetchAll(() => supabase.from('assessments').select('*').eq('assignment_id', assignment.id).eq('grading_period_id', period.id).order('assessment_date', { nullsFirst: true }).order('created_at').order('id')),
        fetchAll(() => supabase.from('quarterly_grades').select('student_id,status,is_complete,transmuted_grade').eq('assignment_id', assignment.id).eq('grading_period_id', period.id).order('id')),
      ])
      const ids = assessments.map((a) => a.id)
      const scores = ids.length ? await fetchAll(() => supabase.from('scores').select('assessment_id,student_id,score,is_excused').in('assessment_id', ids).order('id')) : []
      const rows = config?.transmutation_table_id
        ? await fetchAll(() => supabase.from('transmutation_rows').select('min_initial,max_initial,transmuted').eq('table_id', config.transmutation_table_id).order('min_initial'))
        : []
      return { students, assessments, grades, scores, rows }
    },
    [assignment?.id, period?.id, config?.id, config?.transmutation_table_id, reloadKey],
    { enabled: Boolean(assignment && period && config) },
  )

  useEffect(() => {
    if (!data) return
    setScoreMap(Object.fromEntries(data.scores.map((r) => [keyOf(r.assessment_id, r.student_id), { score: r.score, is_excused: r.is_excused }])))
  }, [data])

  useBeforeUnload(pending > 0)

  const ordered = useMemo(() => (data ? COMPONENTS.flatMap((c) => data.assessments.filter((a) => a.category === c)) : []), [data])
  const results = useMemo(() => {
    if (!data) return {}
    const out = {}
    for (const st of data.students) {
      const mine = {}
      for (const a of data.assessments) mine[a.id] = scoreMap[keyOf(a.id, st.id)]
      out[st.id] = computeTermGrade({ assessments: data.assessments, scores: mine, config, transmutationRows: data.rows })
    }
    return out
  }, [data, scoreMap, config])

  const statuses = data?.grades.map((g) => g.status) ?? []
  const locked = statuses.some((x) => x === 'finalized' || x === 'approved')
  const termStatus = !locked ? 'provisional' : statuses.every((x) => x === 'approved') ? 'approved' : 'finalized'
  const reload = () => setReloadKey((n) => n + 1)
  const editable = canEdit && !locked

  // ----- saving a score -----
  async function saveScore(assessment, student, parsed) {
    const key = keyOf(assessment.id, student.id)
    const prev = scoreMap[key]
    let next
    if (parsed.kind === 'value') next = { score: parsed.value, is_excused: false }
    else if (parsed.kind === 'excused') next = { score: null, is_excused: true }
    else next = undefined // missing: remove the row
    const same = (prev?.score ?? null) === (next?.score ?? null) && !!prev?.is_excused === !!next?.is_excused && !!prev === !!next
    if (same) return true

    setScoreMap((m) => { const c = { ...m }; if (next) c[key] = next; else delete c[key]; return c })
    setPending((n) => n + 1)
    const base = { school_id: s.school.id, assessment_id: assessment.id, student_id: student.id }
    const r = next
      ? await supabase.from('scores').upsert({ ...base, ...next }, { onConflict: 'assessment_id,student_id' })
      : await supabase.from('scores').delete().eq('assessment_id', assessment.id).eq('student_id', student.id)
    setPending((n) => n - 1)
    if (r.error) {
      setScoreMap((m) => { const c = { ...m }; if (prev) c[key] = prev; else delete c[key]; return c })
      toast.error(friendlyError(r.error))
      return false
    }
    return true
  }

  // ----- workflow -----
  const rpc = (fn, message) => async () => {
    const r = await run(async () => unwrap(await supabase.rpc(fn, { p_assignment: assignment.id, p_period: period.id })), message)
    setConfirm(null)
    if (r.ok) reload()
  }

  function exportCsv() {
    const head = ['LRN', 'Last Name', 'First Name', ...ordered.map((a) => `${a.title} [${a.category}]`), 'WW %', 'PT %', 'QA %', 'Initial Grade', 'Quarterly Grade', 'Status']
    const rows = data.students.map((st) => {
      const r = results[st.id]
      return [new ExcelText(st.lrn), st.last_name, st.first_name, ...ordered.map((a) => display(scoreMap[keyOf(a.id, st.id)])),
        ...COMPONENTS.map((c) => (r.components[c].pct === null ? '' : Math.round(r.components[c].pct * 100) / 100)),
        r.initialGrade ?? '', r.transmutedGrade ?? '', r.isComplete ? 'Complete' : r.status === 'incomplete' ? 'Incomplete' : 'Provisional (missing scores)']
    })
    downloadCsv(`gradebook-${section.name}-${subject.name}-${period.name}.csv`.replace(/\s+/g, '_'), [head, ...rows])
  }

  const passing = Number(config?.passing_grade ?? 75)
  const hasMixedWeights = data && COMPONENTS.filter((c) => {
    const list = data.assessments.filter((a) => a.category === c)
    return list.some((a) => a.weight != null) && !list.every((a) => a.weight != null)
  })

  // ===== render =====
  if (avail.length === 0) {
    return (
      <>
        <PageHeader title="Gradebook" />
        <div className="card"><EmptyState icon={Table2} title="No classes to grade yet">
          {s.can('assignments.manage') ? 'Assign a teacher to a section and subject under Subjects, Teacher assignments.' : 'You are not assigned to any class this school year. Ask your administrator.'}
        </EmptyState></div>
      </>
    )
  }

  return (
    <>
      <PageHeader title="Gradebook" subtitle="Enter scores directly in the table. Grades recompute instantly and save automatically.">
        {data && <Button icon={Download} onClick={exportCsv}>Export CSV</Button>}
        {data && editable && <Button icon={Upload} onClick={() => setImporting(true)}>Import scores</Button>}
        {data && <Button icon={Printer} onClick={() => window.print()}>Print sheet</Button>}
      </PageHeader>

      <div className="toolbar no-print">
        <Select value={levelId} onChange={(v) => setSel({ level: v, section: '', assignment: '', period: sel.period })} options={levelOpts.map((l) => ({ value: l.id, label: l.name }))} aria-label="Grade level" />
        <Select value={sectionId} onChange={(v) => setSel((x) => ({ ...x, level: levelId, section: v, assignment: '' }))} options={sectionOpts.map((x) => ({ value: x.id, label: x.name }))} aria-label="Section" />
        <Select value={assignment?.id} onChange={(v) => setSel((x) => ({ ...x, level: levelId, section: sectionId, assignment: v }))} options={subjOpts.map((x) => ({ value: x.a.id, label: x.subject?.name ?? '?' }))} aria-label="Subject" />
        <Select value={period?.id} onChange={(v) => setSel((x) => ({ ...x, period: v }))} options={s.periods.map((p) => ({ value: p.id, label: p.name }))} aria-label="Grading period" />
        <span className="muted small">School year {s.year.label}</span>
      </div>

      {!config && <Alert type="danger">This subject has no grading configuration. Set one under Subjects.</Alert>}
      {config && (
        <div className="row no-print" style={{ marginBottom: 12 }}>
          <StatusBadge status={termStatus} />
          <Badge>WW {config.ww_weight}% - PT {config.pt_weight}% - QA {config.qa_weight}%</Badge>
          <VerifiedBadge verified={config.is_verified} />
          {config.transmutation_mode === 'zero_based' ? <Badge tone="info">Zero-based (no transmutation)</Badge> : null}
          <span className="grow" />
          {pending > 0 ? <span className="muted small row"><Loader2 size={15} className="spin" /> Saving...</span> : data ? <span className="muted small row"><CheckCircle2 size={15} /> All changes saved</span> : null}
          {data && !locked && canEdit && s.can('grades.finalize') && (
            <Button icon={Lock} disabled={busy || pending > 0} onClick={() => setConfirm({ title: `Finalize ${period.name}?`, message: <p>Finalizing locks every score and assessment for <strong>{subject.name}, {section.name}, {period.name}</strong>. Every learner must have a complete grade. A finalized term can be reopened until it is approved.</p>, label: 'Finalize', run: rpc('finalize_term', 'Term finalized.') })}>Finalize term</Button>
          )}
          {data && locked && termStatus === 'finalized' && s.can('grades.approve') && (
            <Button variant="primary" icon={ShieldCheck} disabled={busy} onClick={() => setConfirm({ title: 'Approve grades?', message: <p>Approve the finalized grades for <strong>{subject.name}, {section.name}, {period.name}</strong>. Approved grades can be returned only by the school head or an administrator.</p>, label: 'Approve', run: rpc('approve_term', 'Grades approved.') })}>Approve</Button>
          )}
          {data && locked && (canEdit || s.can('grades.approve')) && (
            <Button icon={Unlock} disabled={busy} onClick={() => setConfirm({ title: 'Reopen term for editing?', message: <p>Scores become editable again and the finalized or approved status is removed. This is recorded in the audit log.</p>, label: 'Reopen', danger: true, run: rpc('reopen_term', 'Term reopened.') })}>{termStatus === 'approved' ? 'Return for changes' : 'Reopen'}</Button>
          )}
        </div>
      )}

      {!canEdit && config && assignment && <Alert type="info" className="no-print">You can view this class but not change its scores{locked ? ' (the term is finalized)' : ''}.</Alert>}
      {canEdit && locked && <Alert type="info" className="no-print">This term is {termStatus}. Scores are locked. Reopen the term to make changes.</Alert>}
      {hasMixedWeights?.length > 0 && <Alert type="warn" className="no-print">In {hasMixedWeights.map((c) => COMPONENT_LABELS[c]).join(' and ')}, only some assessments have a weight, so total points are used for that component. Give every assessment in a component a weight to use weighted scoring.</Alert>}
      <div className="spacer no-print" />

      {loading && !data ? <Loading /> : error ? <Alert type="danger">{error.message}</Alert> : data && (
        <>
          <div className="card screen-only">
            <div className="card-head">
              <div>
                <h2>{subject.name} - {s.levelName(section.grade_level_id)} {section.name}</h2>
                <span className="muted small">{period.name} - Teacher: {s.memberName(assignment.teacher_id)}</span>
              </div>
              {editable && s.can('assessments.write') && (
                <div className="row">
                  {COMPONENTS.map((c) => <Button key={c} size="sm" icon={Plus} onClick={() => setAssessmentForm({ assessment: null, category: c })}>{c}</Button>)}
                </div>
              )}
            </div>
            {data.students.length === 0 ? (
              <EmptyState icon={Table2} title="No enrolled learners in this section">Add learners on the Students page.</EmptyState>
            ) : data.assessments.length === 0 ? (
              <EmptyState icon={Table2} title="No assessments yet" action={editable ? <Button variant="primary" icon={Plus} onClick={() => setAssessmentForm({ assessment: null, category: 'WW' })}>Add an assessment</Button> : null}>
                Add Written Works, Performance Tasks and a Quarterly Assessment, then enter scores here.
              </EmptyState>
            ) : (
              <div className="gb-wrap">
                <table className="gb">
                  <thead>
                    <tr>
                      <th className="sticky-1" rowSpan={2}>Learner</th>
                      {COMPONENTS.map((c) => {
                        const n = data.assessments.filter((a) => a.category === c).length
                        return <th key={c} colSpan={n + 2} className={`cat-${c}`}>{COMPONENT_LABELS[c]} ({config[`${c.toLowerCase()}_weight`]}%)</th>
                      })}
                      <th rowSpan={2}>Initial grade</th>
                      <th rowSpan={2}>{period.name.replace(/\D+$/, '') ? 'Grade' : 'Grade'}</th>
                      <th rowSpan={2}>Status</th>
                    </tr>
                    <tr className="second">
                      {COMPONENTS.flatMap((c) => {
                        const list = data.assessments.filter((a) => a.category === c)
                        const total = list.reduce((x, a) => x + Number(a.max_score), 0)
                        return [
                          ...list.map((a) => (
                            <th key={a.id} className={`cat-${c}`}>
                              <span className="th-title" title={a.title}>{a.title}</span>
                              <span className="th-meta">/ {a.max_score}{a.weight != null ? ` - ${a.weight}%` : ''}</span>
                              <span className="th-meta">{fmtDate(a.assessment_date)}</span>
                              {editable && s.can('assessments.write') && <button className="btn btn-ghost btn-sm btn-icon" aria-label={`Edit ${a.title}`} onClick={() => setAssessmentForm({ assessment: a, category: a.category })}><Pencil size={13} /></button>}
                            </th>
                          )),
                          <th key={`${c}-t`} className={`cat-${c}`}>Total<span className="th-meta">/ {total}</span></th>,
                          <th key={`${c}-p`} className={`cat-${c}`}>%</th>,
                        ]
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {data.students.map((st, ri) => {
                      const r = results[st.id]
                      const failed = r.transmutedGrade !== null && r.transmutedGrade < passing
                      return (
                        <tr key={st.id}>
                          <td className="sticky-1"><strong>{fullName(st)}</strong><span className="muted small" style={{ display: 'block' }}>{st.lrn}</span></td>
                          {COMPONENTS.flatMap((c) => {
                            const list = data.assessments.filter((a) => a.category === c)
                            const comp = r.components[c]
                            return [
                              ...list.map((a) => (
                                <td key={a.id}>
                                  <ScoreCell row={ri} col={ordered.indexOf(a)} value={scoreMap[keyOf(a.id, st.id)]} max={a.max_score} disabled={!editable}
                                    label={`${fullName(st)}, ${a.title}`} onCommit={(parsed) => saveScore(a, st, parsed)} />
                                </td>
                              )),
                              <td key={`${c}-t`} className="calc">{comp.scored ? fmtNum(comp.earned, 2).replace(/\.00$/, '') : '-'}</td>,
                              <td key={`${c}-p`} className="calc">{fmtPct(comp.pct, 1)}</td>,
                            ]
                          })}
                          <td className="calc">{fmtNum(r.initialGrade, 2)}</td>
                          <td className={`grade-cell ${failed ? 'grade-fail' : ''}`} title={r.reasons.join(' ')}>{fmtGrade(r.transmutedGrade)}</td>
                          <td>{r.isComplete ? <Badge tone="ok">Complete</Badge> : <span title={r.reasons.join(' ')}><Badge tone="warn">{r.status === 'incomplete' ? 'Incomplete' : `${r.missingCount} missing`}</Badge></span>}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="card-pad legend no-print">
              <span><Info size={13} style={{ verticalAlign: -2 }} /> Leave a cell blank for a score not yet recorded; a blank is <strong>never</strong> counted as zero. Type <strong>0</strong> for a real zero and <strong>X</strong> to excuse a learner from an assessment.</span>
              <span>Enter / arrow keys move between cells.</span>
            </div>
          </div>

          <PrintSheet data={data} results={results} ordered={ordered} scoreMap={scoreMap} config={config} subject={subject} section={section} period={period} assignment={assignment} termStatus={termStatus} passing={passing} />
        </>
      )}

      {assessmentForm && (
        <AssessmentForm assessment={assessmentForm.assessment} category={assessmentForm.category} assignment={assignment} period={period}
          onClose={() => setAssessmentForm(null)} onSaved={() => { setAssessmentForm(null); reload() }} />
      )}
      {importing && data && <ImportScores data={data} ordered={ordered} onClose={() => setImporting(false)} onDone={reload} />}
      {confirm && <ConfirmDialog title={confirm.title} message={confirm.message} danger={confirm.danger} confirmLabel={confirm.label} busy={busy} onConfirm={confirm.run} onCancel={() => setConfirm(null)} />}
    </>
  )
}

/** One spreadsheet cell. Validates as you type, commits on blur/Enter, moves with the keyboard. */
function ScoreCell({ row, col, value, max, disabled, label, onCommit }) {
  const [text, setText] = useState(display(value))
  const [state, setState] = useState('') // '' | 'saving' | 'invalid'
  const [err, setErr] = useState('')
  useEffect(() => setText(display(value)), [value])

  async function commit() {
    const parsed = parseScoreInput(text, max)
    if (parsed.kind === 'error') { setState('invalid'); setErr(parsed.error); return }
    setErr('')
    setState('saving')
    const ok = await onCommit(parsed)
    setState(ok ? '' : 'invalid')
    if (!ok) setText(display(value))
  }

  const move = (dr, dc = 0) => {
    const el = document.querySelector(`input[data-r="${row + dr}"][data-c="${col + dc}"]`)
    if (el) { el.focus(); el.select?.() }
    return Boolean(el)
  }

  const parsedNow = parseScoreInput(text, max)
  const cls = ['score-input', state === 'saving' && 'saving', (state === 'invalid' || parsedNow.kind === 'error') && 'invalid',
    parsedNow.kind === 'missing' && 'missing', parsedNow.kind === 'excused' && 'excused'].filter(Boolean).join(' ')

  return (
    <input className={cls} value={text} disabled={disabled} inputMode="decimal" autoComplete="off" data-r={row} data-c={col}
      aria-label={label} aria-invalid={parsedNow.kind === 'error' ? 'true' : undefined} title={parsedNow.kind === 'error' ? parsedNow.error : err || `Out of ${max}`}
      onChange={(e) => { setText(e.target.value); setState('') }} onFocus={(e) => e.target.select()} onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); if (!move(1) && e.key === 'Enter') move(-row, 1) }
        else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
        else if (e.key === 'Escape') { setText(display(value)); setState('') }
      }} />
  )
}

const EXAM_PRESETS = [
  { title: 'Summative Test 1', weight: 30 },
  { title: 'Summative Test 2', weight: 30 },
  { title: 'Term Examination', weight: 40 },
]

function AssessmentForm({ assessment, category, assignment, period, onClose, onSaved }) {
  const s = useSchool()
  const { busy, run } = useRunner()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [f, setF] = useState({
    category: assessment?.category ?? category, title: assessment?.title ?? '', assessment_date: assessment?.assessment_date ?? new Date().toISOString().slice(0, 10),
    max_score: assessment?.max_score ?? '', weight: assessment?.weight ?? '',
  })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))

  async function save() {
    const errs = {}
    if (!f.title.trim()) errs.title = 'Enter a title.'
    const max = Number(f.max_score)
    if (f.max_score === '' || Number.isNaN(max) || max <= 0) errs.max_score = 'Enter a maximum score above 0.'
    else if (max > 9999.99 || !/^\d+(\.\d{1,2})?$/.test(String(f.max_score))) errs.max_score = 'Use at most 2 decimals and no more than 9999.99.'
    if (f.weight !== '' && (Number.isNaN(Number(f.weight)) || Number(f.weight) <= 0 || Number(f.weight) > 100)) errs.weight = 'A weight is a percentage above 0 and up to 100, or leave it blank.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    const payload = { category: f.category, title: f.title.trim(), assessment_date: f.assessment_date || null, max_score: max, weight: f.weight === '' ? null : Number(f.weight) }
    const r = await run(async () => {
      if (assessment) unwrap(await supabase.from('assessments').update(payload).eq('id', assessment.id))
      else unwrap(await supabase.from('assessments').insert({ ...payload, school_id: s.school.id, assignment_id: assignment.id, grading_period_id: period.id }))
    }, assessment ? 'Assessment updated. Grades recomputed.' : 'Assessment added.')
    if (r.ok) onSaved()
  }

  async function remove() {
    const r = await run(async () => unwrap(await supabase.from('assessments').delete().eq('id', assessment.id)), 'Assessment deleted. Grades recomputed.')
    if (r.ok) onSaved()
  }

  return (
    <>
      <Modal title={assessment ? 'Edit assessment' : 'Add assessment'} onClose={onClose}
        footer={<>
          {assessment && <Button variant="danger" onClick={() => setConfirmDelete(true)} disabled={busy}>Delete</Button>}
          <span className="grow" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Saving...' : 'Save'}</Button>
        </>}>
        <div className="stack">
          <div className="form-grid">
            <Field label="Component"><Select value={f.category} onChange={(v) => setF((x) => ({ ...x, category: v }))} options={COMPONENTS.map((c) => ({ value: c, label: COMPONENT_LABELS[c] }))} /></Field>
            <Field label="Date"><input className="input" type="date" value={f.assessment_date ?? ''} onChange={set('assessment_date')} /></Field>
            <Field label="Title" error={errors.title} className="full"><input className="input" value={f.title} onChange={set('title')} /></Field>
            <Field label="Maximum score" error={errors.max_score}><input className="input" inputMode="decimal" value={f.max_score} onChange={set('max_score')} /></Field>
            <Field label="Weight within component (%)" error={errors.weight} help="Optional. Used for exam parts such as Summative Test 1 = 30%."><input className="input" inputMode="decimal" value={f.weight} onChange={set('weight')} /></Field>
          </div>
          {f.category === 'QA' && (
            <div>
              <p className="small muted" style={{ marginBottom: 6 }}>Exam presets (DepEd Order 015, s. 2026 reportedly splits the examinations 30 / 30 / 40; verify before use):</p>
              <div className="row">{EXAM_PRESETS.map((p) => <Button key={p.title} size="sm" onClick={() => setF((x) => ({ ...x, title: p.title, weight: p.weight }))}>{p.title} ({p.weight}%)</Button>)}</div>
            </div>
          )}
          <Alert type="info">If every assessment in a component has a weight, that component's percentage is the weighted average of the assessments. Otherwise it is total points earned divided by total points possible.</Alert>
        </div>
      </Modal>
      {confirmDelete && <ConfirmDialog danger title="Delete assessment?" message={<p>Delete <strong>{assessment.title}</strong> and every score entered for it? This cannot be undone.</p>} confirmLabel="Delete" busy={busy} onConfirm={remove} onCancel={() => setConfirmDelete(false)} />}
    </>
  )
}

function ImportScores({ data, ordered, onClose, onDone }) {
  const s = useSchool()
  const { busy, run } = useRunner()
  const [plan, setPlan] = useState(null)
  const [fileError, setFileError] = useState('')
  const [done, setDone] = useState(null)

  const IGNORED = new Set(['lrn', 'last name', 'first name', 'ww %', 'pt %', 'qa %', 'initial grade', 'quarterly grade', 'status'])

  async function onFile(file) {
    setFileError(''); setDone(null); setPlan(null)
    if (!file) return
    try {
      const rows = parseCsv(await readFileText(file))
      if (rows.length < 2) return setFileError('The file has no data rows.')
      const head = rows[0].map((h) => String(h).trim())
      const lrnCol = head.findIndex((h) => h.toLowerCase() === 'lrn')
      if (lrnCol < 0) return setFileError('The file needs an LRN column. Export the gradebook to get the right layout.')

      const byLabel = new Map()
      for (const a of ordered) {
        byLabel.set(`${a.title} [${a.category}]`.toLowerCase(), a)
        const dupes = ordered.filter((x) => x.title.toLowerCase() === a.title.toLowerCase()).length
        if (dupes === 1) byLabel.set(a.title.toLowerCase(), a)
      }
      const cols = []
      const unknown = []
      head.forEach((h, i) => {
        if (i === lrnCol || IGNORED.has(h.toLowerCase()) || h === '') return
        const a = byLabel.get(h.toLowerCase())
        if (a) cols.push({ i, a }); else unknown.push(h)
      })
      if (unknown.length) return setFileError(`These columns do not match any assessment in this class and term: ${unknown.join(', ')}. Nothing was imported.`)
      if (cols.length === 0) return setFileError('No assessment columns were found.')

      const byLrn = new Map(data.students.map((st) => [st.lrn, st]))
      const errors = []
      const upserts = []
      rows.slice(1).forEach((r, idx) => {
        const line = idx + 2
        const lrn = normalizeLrn(r[lrnCol])
        const st = byLrn.get(lrn)
        if (!st) return errors.push(`Line ${line}: LRN ${lrn || '(blank)'} is not an enrolled learner in this section.`)
        for (const { i, a } of cols) {
          const parsed = parseScoreInput(r[i], a.max_score)
          if (parsed.kind === 'error') errors.push(`Line ${line}, ${a.title}: ${parsed.error}`)
          else if (parsed.kind === 'value') upserts.push({ school_id: s.school.id, assessment_id: a.id, student_id: st.id, score: parsed.value, is_excused: false })
          else if (parsed.kind === 'excused') upserts.push({ school_id: s.school.id, assessment_id: a.id, student_id: st.id, score: null, is_excused: true })
          // blank cells are skipped: an import never overwrites a score with "missing"
        }
      })
      setPlan({ errors, upserts })
    } catch (e) { setFileError(e.message) }
  }

  async function doImport() {
    const r = await run(async () => {
      for (let i = 0; i < plan.upserts.length; i += 200) {
        unwrap(await supabase.from('scores').upsert(plan.upserts.slice(i, i + 200), { onConflict: 'assessment_id,student_id' }))
      }
      return plan.upserts.length
    })
    if (r.ok) { setDone(r.result); onDone() }
  }

  return (
    <Modal title="Import scores from CSV" size="wide" onClose={onClose}
      footer={done !== null ? <Button variant="primary" onClick={onClose}>Done</Button> : <><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={doImport} disabled={busy || !plan || plan.errors.length > 0 || plan.upserts.length === 0}>{busy ? 'Importing...' : `Import ${plan?.upserts.length ?? 0} scores`}</Button></>}>
      <div className="stack">
        <p className="muted">Use the file from <strong>Export CSV</strong>: an <code>LRN</code> column plus one column per assessment (<code>Title [WW]</code>). Blank cells are skipped, never imported as zero. Use X for excused. If anything is invalid, nothing is imported.</p>
        <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} aria-label="CSV file" />
        {fileError && <Alert type="danger">{fileError}</Alert>}
        {done !== null && <Alert type="ok">Imported {done} scores. Grades were recomputed.</Alert>}
        {plan && done === null && (plan.errors.length === 0
          ? <Alert type="ok">{plan.upserts.length} scores are ready to import.</Alert>
          : <Alert type="danger"><strong>{plan.errors.length} problem(s) found. Fix the file and try again.</strong><ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{plan.errors.slice(0, 30).map((e) => <li key={e}>{e}</li>)}</ul>{plan.errors.length > 30 && <p>...and {plan.errors.length - 30} more.</p>}</Alert>)}
      </div>
    </Modal>
  )
}

/** Print-only layout of the whole class grading sheet. */
function PrintSheet({ data, results, ordered, scoreMap, config, subject, section, period, assignment, termStatus, passing }) {
  const s = useSchool()
  return (
    <div className="print-only sheet-print">
      <PrintPage paper={s.settings?.default_paper} landscape margin="10mm" />
      <h2>{s.school.name} - Class Grading Sheet</h2>
      <div className="meta">
        <span><strong>Subject:</strong> {subject.name}</span>
        <span><strong>Section:</strong> {s.levelName(section.grade_level_id)} - {section.name}</span>
        <span><strong>{period.name}</strong>, SY {s.year.label}</span>
        <span><strong>Teacher:</strong> {s.memberName(assignment.teacher_id)}</span>
        <span><strong>Weights:</strong> WW {config.ww_weight}% / PT {config.pt_weight}% / QA {config.qa_weight}%</span>
      </div>
      {termStatus === 'provisional' && <p style={{ fontWeight: 700, color: '#b42318', margin: '0 0 6px' }}>PROVISIONAL: grades are not finalized.</p>}
      {!config.is_verified && <p style={{ fontWeight: 700, color: '#92560a', margin: '0 0 6px' }}>Grading rules are not yet verified against the official DepEd issuance.</p>}
      <table>
        <thead>
          <tr>
            <th rowSpan={2}>No.</th><th rowSpan={2}>Learner</th>
            {COMPONENTS.map((c) => <th key={c} colSpan={data.assessments.filter((a) => a.category === c).length + 1}>{c}</th>)}
            <th rowSpan={2}>Initial</th><th rowSpan={2}>Grade</th><th rowSpan={2}>Remarks</th>
          </tr>
          <tr>
            {COMPONENTS.flatMap((c) => [...data.assessments.filter((a) => a.category === c).map((a) => <th key={a.id}>{a.title}<br />/{a.max_score}</th>), <th key={`${c}p`}>%</th>])}
          </tr>
        </thead>
        <tbody>
          {data.students.map((st, i) => {
            const r = results[st.id]
            return (
              <tr key={st.id}>
                <td>{i + 1}</td><td className="name">{fullName(st)}</td>
                {COMPONENTS.flatMap((c) => [...data.assessments.filter((a) => a.category === c).map((a) => <td key={a.id}>{display(scoreMap[keyOf(a.id, st.id)])}</td>), <td key={`${c}p`}>{fmtPct(r.components[c].pct, 1)}</td>])}
                <td>{fmtNum(r.initialGrade, 2)}</td><td><strong>{fmtGrade(r.transmutedGrade)}</strong></td>
                <td>{r.isComplete ? remarkFor(r.transmutedGrade, passing) : 'Incomplete'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="meta" style={{ marginTop: 28, justifyContent: 'space-between' }}>
        <span>Prepared by: ______________________ ({s.memberName(assignment.teacher_id)})</span>
        <span>Checked by: ______________________</span>
        <span>Printed {new Date().toLocaleDateString('en-PH')}</span>
      </div>
    </div>
  )
}
