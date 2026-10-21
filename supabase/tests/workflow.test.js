import { describe, it, expect, beforeAll } from 'vitest'
import { createDb, addUser, as, q } from './harness.js'
import { computeTermGrade, computeFinalGrade } from '../../src/lib/grading/index.js'

let db, u, school, a1, terms, studentsOfA1

beforeAll(async () => {
  db = await createDb()
  u = {
    admin: await addUser(db, 'admin@example.test'),
    teacher: await addUser(db, 'teacher@example.test'),
    head: await addUser(db, 'head@example.test'),
  }
  school = (await as(db, u.admin, () => q(db, `select public.bootstrap_school('Workflow School') id`)))[0].id
  await as(db, u.admin, async () => {
    await q(db, `select public.add_member_by_email($1,'teacher@example.test','teacher')`, [school])
    await q(db, `select public.add_member_by_email($1,'head@example.test','reviewer')`, [school])
    await q(db, `select public.seed_demo_data($1)`, [school])
    // hand the first demo class to the teacher
    a1 = (await q(db, `select ta.id from public.teacher_assignments ta join public.sections s on s.id=ta.section_id
                       join public.subjects sub on sub.id=ta.subject_id
                       where s.name='Demo Narra' and sub.name='Mathematics'`))[0].id
    await q(db, `update public.teacher_assignments set teacher_id=$1 where id=$2`, [u.teacher, a1])
  })
  terms = (await q(db, `select id, term_no from public.grading_periods order by term_no`)).map((t) => t.id)
  studentsOfA1 = (await q(db, `select st.id from public.students st join public.teacher_assignments ta on ta.section_id=st.section_id where ta.id=$1 order by st.lrn`, [a1])).map((r) => r.id)
}, 180000)

describe('SQL and JavaScript grade engines agree', () => {
  it('on every computed demo grade (including incomplete ones)', async () => {
    const cfgs = await q(db, `select ta.id aid, gc.ww_weight::float ww_weight, gc.pt_weight::float pt_weight, gc.qa_weight::float qa_weight,
      gc.missing_policy, gc.initial_decimals, gc.transmutation_mode, gc.minimum_reportable_grade, gc.transmutation_table_id tid
      from public.teacher_assignments ta join public.subjects s on s.id=ta.subject_id join public.grading_configurations gc on gc.id=s.grading_configuration_id`)
    const cfgBy = Object.fromEntries(cfgs.map((c) => [c.aid, c]))
    const rowsBy = {}
    for (const r of await q(db, `select table_id, min_initial::float min_initial, max_initial::float max_initial, transmuted from public.transmutation_rows`)) (rowsBy[r.table_id] ??= []).push(r)
    const asm = await q(db, `select id, assignment_id, grading_period_id pid, category, max_score::float max_score, weight::float weight from public.assessments`)
    const scoreRows = await q(db, `select assessment_id, student_id, score::float score, is_excused from public.scores`)
    const grades = await q(db, `select assignment_id, grading_period_id pid, student_id, initial_grade::float initial, transmuted_grade t, is_complete, missing_count, status, ww_pct::float ww_pct, pt_pct::float pt_pct, qa_pct::float qa_pct from public.quarterly_grades`)
    expect(grades.length).toBe(72)

    let incomplete = 0
    for (const g of grades) {
      const list = asm.filter((a) => a.assignment_id === g.assignment_id && a.pid === g.pid).map((a) => ({ ...a, weight: a.weight ?? undefined }))
      const scores = {}
      for (const s of scoreRows) if (s.student_id === g.student_id) scores[s.assessment_id] = { score: s.score, is_excused: s.is_excused }
      const cfg = cfgBy[g.assignment_id]
      const js = computeTermGrade({ assessments: list, scores, config: cfg, transmutationRows: rowsBy[cfg.tid] ?? [] })
      expect(js.initialGrade, `initial ${g.student_id}`).toBe(g.initial)
      expect(js.transmutedGrade, `transmuted ${g.student_id}`).toBe(g.t)
      expect(js.isComplete).toBe(g.is_complete)
      expect(js.missingCount).toBe(g.missing_count)
      expect(js.status).toBe(g.status)
      for (const [k, col] of [['WW', 'ww_pct'], ['PT', 'pt_pct'], ['QA', 'qa_pct']]) {
        if (js.components[k].pct === null) expect(g[col]).toBeNull()
        else expect(Math.round(js.components[k].pct * 100) / 100).toBeCloseTo(g[col], 2)
      }
      if (!g.is_complete) incomplete++
    }
    expect(incomplete).toBeGreaterThan(0) // the demo data deliberately contains missing scores
  })
})

describe('finalize -> lock -> approve -> reopen', () => {
  it('cannot finalize while a learner is incomplete', async () => {
    await expect(as(db, u.teacher, () => q(db, `select public.finalize_term($1,$2)`, [a1, terms[0]]))).rejects.toThrow(/incomplete grades/)
  })

  it('finalizes once complete, then locks scores and assessments', async () => {
    // fill the deliberately missing scores for this class
    await as(db, u.teacher, async () => {
      const missing = await q(db, `select a.id aid, st.id sid, a.max_score from public.assessments a
        join public.teacher_assignments ta on ta.id=a.assignment_id
        join public.students st on st.section_id=ta.section_id
        left join public.scores sc on sc.assessment_id=a.id and sc.student_id=st.id
        where a.assignment_id=$1 and a.grading_period_id=$2 and sc.id is null`, [a1, terms[0]])
      expect(missing.length).toBeGreaterThan(0)
      for (const m of missing) await q(db, `insert into public.scores (school_id,assessment_id,student_id,score) values ($1,$2,$3,$4)`, [school, m.aid, m.sid, Number(m.max_score) * 0.8])
    })
    const n = await as(db, u.teacher, () => q(db, `select public.finalize_term($1,$2) n`, [a1, terms[0]]))
    expect(n[0].n).toBe(12)
    const st = await q(db, `select distinct status from public.quarterly_grades where assignment_id=$1 and grading_period_id=$2`, [a1, terms[0]])
    expect(st).toEqual([{ status: 'finalized' }])

    await expect(as(db, u.teacher, () => q(db, `update public.scores set score=1 where assessment_id in (select id from public.assessments where assignment_id=$1 and grading_period_id=$2)`, [a1, terms[0]]))).rejects.toThrow(/finalized/)
    await expect(as(db, u.teacher, () => q(db, `delete from public.assessments where assignment_id=$1 and grading_period_id=$2`, [a1, terms[0]]))).rejects.toThrow(/finalized/)
    await expect(as(db, u.teacher, () => q(db, `insert into public.assessments (school_id,assignment_id,grading_period_id,category,title,max_score) values ($1,$2,$3,'WW','Late',10)`, [school, a1, terms[0]]))).rejects.toThrow(/finalized/)
  })

  it('only the school head or an administrator can approve; reviewers cannot finalize', async () => {
    await expect(as(db, u.teacher, () => q(db, `select public.approve_term($1,$2)`, [a1, terms[0]]))).rejects.toThrow(/Only the school head/)
    await expect(as(db, u.head, () => q(db, `select public.finalize_term($1,$2)`, [a1, terms[1]]))).rejects.toThrow(/not allowed/)
    const n = await as(db, u.head, () => q(db, `select public.approve_term($1,$2) n`, [a1, terms[0]]))
    expect(n[0].n).toBe(12)
    expect((await q(db, `select distinct status from public.quarterly_grades where assignment_id=$1 and grading_period_id=$2`, [a1, terms[0]]))[0].status).toBe('approved')
  })

  it('approved grades can be returned only by the head or an administrator, and the audit log shows who did what', async () => {
    await expect(as(db, u.teacher, () => q(db, `select public.reopen_term($1,$2)`, [a1, terms[0]]))).rejects.toThrow(/Approved grades can only be reopened/)
    await as(db, u.head, () => q(db, `select public.reopen_term($1,$2)`, [a1, terms[0]]))
    expect((await q(db, `select distinct status from public.quarterly_grades where assignment_id=$1 and grading_period_id=$2`, [a1, terms[0]]))[0].status).toBe('provisional')
    const log = await q(db, `select new_data->>'status' status, actor_id from public.audit_logs where table_name='quarterly_grades' order by created_at`)
    const actors = new Set(log.map((l) => l.actor_id))
    expect(log.some((l) => l.status === 'finalized')).toBe(true)
    expect(log.some((l) => l.status === 'approved')).toBe(true)
    expect(actors.has(u.teacher) && actors.has(u.head)).toBe(true)
    // scores are editable again after reopening
    await as(db, u.teacher, () => q(db, `update public.scores set score=score where assessment_id in (select id from public.assessments where assignment_id=$1)`, [a1]))
  })
})

describe('final grade across terms', () => {
  it('is null until every term has a grade, then the rounded average, with status following the terms', async () => {
    expect((await q(db, `select final_grade from public.final_grades where assignment_id=$1 limit 1`, [a1]))[0].final_grade).toBeNull()

    for (const t of [terms[1], terms[2]]) {
      await as(db, u.teacher, async () => {
        for (const [cat, max, w] of [['WW', 10, null], ['PT', 10, null], ['QA', 10, null]]) {
          const id = (await q(db, `insert into public.assessments (school_id,assignment_id,grading_period_id,category,title,max_score,weight) values ($1,$2,$3,$4::public.assessment_category,$4::text||' task',$5,$6) returning id`, [school, a1, t, cat, max, w]))[0].id
          for (const s of studentsOfA1) await q(db, `insert into public.scores (school_id,assessment_id,student_id,score) values ($1,$2,$3,9)`, [school, id, s])
        }
      })
    }
    const rows = await q(db, `select student_id, term1, term2, term3, term4, final_grade, remarks, status from public.final_grades where assignment_id=$1`, [a1])
    expect(rows).toHaveLength(12)
    for (const r of rows) {
      expect(r.term2).toBe(91) // 90% in every component -> initial 90.00 -> band 88.88-90.05
      expect(r.term3).toBe(91)
      expect(r.term4).toBeNull() // a 3-term school year has no 4th term
      expect(r.final_grade).toBe(computeFinalGrade([r.term1, r.term2, r.term3], 3))
      expect(r.remarks).toBe(r.final_grade >= 75 ? 'Passed' : 'Failed')
      expect(r.status).toBe('provisional')
    }
    // finalize all three terms: the final grade becomes finalized
    for (const t of terms) await as(db, u.teacher, () => q(db, `select public.finalize_term($1,$2)`, [a1, t]))
    expect((await q(db, `select distinct status from public.final_grades where assignment_id=$1`, [a1]))).toEqual([{ status: 'finalized' }])
  })
})

describe('dashboard summary is computed from real rows and respects RLS', () => {
  it('counts learners, sections, and grades for the right viewer', async () => {
    const [year] = await q(db, `select id from public.academic_years`)
    const run = (uid) => as(db, uid, async () => (await q(db, `select public.dashboard_summary($1,$2,$3,current_date) s`, [school, year.id, terms[0]]))[0].s)
    const admin = await run(u.admin)
    expect(admin.students).toBe(24)
    expect(admin.sections).toBe(2)
    expect(admin.subjects).toBe(3)
    expect(admin.class_average).toBeGreaterThan(60)
    expect(Object.values(admin.histogram).reduce((s, n) => s + n, 0)).toBe(72)
    const teacher = await run(u.teacher) // only the one class assigned to them
    expect(teacher.sections).toBe(1)
    expect(teacher.students).toBe(12)
    expect(teacher.subjects).toBe(1)
    expect(teacher.students_complete).toBe(12)
  })
})
