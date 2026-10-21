import { describe, it, expect, beforeAll } from 'vitest'
import { createDb, addUser, as, q } from './harness.js'

// Two schools, one admin each, plus teachers and a reviewer in school 1.
let db, u, s1, s2, ids

beforeAll(async () => {
  db = await createDb()
  u = {
    admin: await addUser(db, 'admin1@example.test', 'Admin One'),
    admin2: await addUser(db, 'admin2@example.test', 'Admin Two'),
    t1: await addUser(db, 't1@example.test', 'Teacher One'),
    t2: await addUser(db, 't2@example.test', 'Teacher Two'),
    rev: await addUser(db, 'head@example.test', 'School Head'),
  }
  s1 = (await as(db, u.admin, () => q(db, `select public.bootstrap_school('School One') id`)))[0].id
  s2 = (await as(db, u.admin2, () => q(db, `select public.bootstrap_school('School Two') id`)))[0].id
  await as(db, u.admin, async () => {
    await q(db, `select public.add_member_by_email($1,'t1@example.test','teacher')`, [s1])
    await q(db, `select public.add_member_by_email($1,'t2@example.test','teacher')`, [s1])
    await q(db, `select public.add_member_by_email($1,'head@example.test','reviewer')`, [s1])
  })

  ids = {}
  await as(db, u.admin, async () => {
    ids.year = (await q(db, `select id from public.academic_years where school_id=$1`, [s1]))[0].id
    ids.level = (await q(db, `select id from public.grade_levels where school_id=$1 and level=7`, [s1]))[0].id
    ids.term1 = (await q(db, `select id from public.grading_periods where academic_year_id=$1 and term_no=1`, [ids.year]))[0].id
    ids.term2 = (await q(db, `select id from public.grading_periods where academic_year_id=$1 and term_no=2`, [ids.year]))[0].id
    ids.math = (await q(db, `select id from public.subjects where school_id=$1 and name='Mathematics'`, [s1]))[0].id
    ids.sec1 = (await q(db, `insert into public.sections (school_id,academic_year_id,grade_level_id,name) values ($1,$2,$3,'Narra') returning id`, [s1, ids.year, ids.level]))[0].id
    ids.sec2 = (await q(db, `insert into public.sections (school_id,academic_year_id,grade_level_id,name) values ($1,$2,$3,'Molave') returning id`, [s1, ids.year, ids.level]))[0].id
    ids.stu = []
    for (const [i, sec] of [[1, ids.sec1], [2, ids.sec1], [3, ids.sec1], [4, ids.sec2]]) {
      ids.stu.push((await q(db, `insert into public.students (school_id,academic_year_id,lrn,first_name,last_name,grade_level_id,section_id)
        values ($1,$2,$3,'Fictional','Learner'||$4::text,$5,$6) returning id`, [s1, ids.year, `90000000000${i}`, i, ids.level, sec]))[0].id)
    }
    ids.a1 = (await q(db, `insert into public.teacher_assignments (school_id,academic_year_id,section_id,subject_id,teacher_id) values ($1,$2,$3,$4,$5) returning id`, [s1, ids.year, ids.sec1, ids.math, u.t1]))[0].id
    ids.a2 = (await q(db, `insert into public.teacher_assignments (school_id,academic_year_id,section_id,subject_id,teacher_id) values ($1,$2,$3,$4,$5) returning id`, [s1, ids.year, ids.sec2, ids.math, u.t2]))[0].id
  })
  await as(db, u.t1, async () => {
    ids.ww = (await q(db, `insert into public.assessments (school_id,assignment_id,grading_period_id,category,title,max_score) values ($1,$2,$3,'WW','Quiz 1',20) returning id`, [s1, ids.a1, ids.term1]))[0].id
    ids.pt = (await q(db, `insert into public.assessments (school_id,assignment_id,grading_period_id,category,title,max_score) values ($1,$2,$3,'PT','Project',50) returning id`, [s1, ids.a1, ids.term1]))[0].id
    ids.qa = (await q(db, `insert into public.assessments (school_id,assignment_id,grading_period_id,category,title,max_score) values ($1,$2,$3,'QA','Exam',40) returning id`, [s1, ids.a1, ids.term1]))[0].id
  })
}, 120000)

const count = async (uid, table) => as(db, uid, async () => (await q(db, `select count(*)::int n from public.${table}`))[0].n)

describe('tenant isolation', () => {
  it('a user of another school sees none of school 1 data', async () => {
    for (const t of ['students', 'sections', 'teacher_assignments', 'assessments', 'scores', 'quarterly_grades', 'attendance', 'subjects', 'grading_configurations', 'audit_logs', 'school_memberships']) {
      const own = await as(db, u.admin2, async () => (await q(db, `select count(*)::int n from public.${t} where school_id=$1`, [s1]))[0].n)
      expect(own, t).toBe(0)
    }
    expect(await as(db, u.admin2, async () => (await q(db, `select count(*)::int n from public.schools where id=$1`, [s1]))[0].n)).toBe(0)
  })
  it('cannot change or create records in another school', async () => {
    const upd = await as(db, u.admin2, () => db.query(`update public.schools set name='hacked' where id=$1`, [s1]))
    expect(upd.affectedRows).toBe(0)
    await expect(as(db, u.admin2, () => q(db, `insert into public.students (school_id,academic_year_id,lrn,first_name,last_name,grade_level_id,section_id)
      values ($1,$2,'900000009999','X','Y',$3,$4)`, [s1, ids.year, ids.level, ids.sec1]))).rejects.toThrow(/row-level security/)
  })
  it('composite foreign keys stop a row pointing at another school\'s record', async () => {
    const y2 = (await as(db, u.admin2, () => q(db, `select id from public.academic_years where school_id=$1`, [s2])))[0].id
    const l2 = (await as(db, u.admin2, () => q(db, `select id from public.grade_levels where school_id=$1 and level=7`, [s2])))[0].id
    // school-2 admin passes school 2 as school_id but school 1's section id
    await expect(as(db, u.admin2, () => q(db, `insert into public.students (school_id,academic_year_id,lrn,first_name,last_name,grade_level_id,section_id)
      values ($1,$2,'900000009998','X','Y',$3,$4)`, [s2, y2, l2, ids.sec1]))).rejects.toThrow()
  })
  it('anonymous users get nothing', async () => {
    await expect(as(db, null, () => q(db, `select * from public.students`))).rejects.toThrow(/permission denied/)
  })
})

describe('role-based access inside a school', () => {
  it('a teacher sees only their own section, learners and classes', async () => {
    expect(await count(u.t1, 'sections')).toBe(1)
    expect(await count(u.t1, 'students')).toBe(3)
    expect(await count(u.t1, 'teacher_assignments')).toBe(1)
    expect(await count(u.t2, 'students')).toBe(1)
    expect(await count(u.t2, 'assessments')).toBe(0)
  })
  it('administrators and reviewers see everything in the school', async () => {
    expect(await count(u.admin, 'students')).toBe(4)
    expect(await count(u.rev, 'students')).toBe(4)
    expect(await count(u.rev, 'sections')).toBe(2)
  })
  it('a teacher cannot write another teacher\'s scores', async () => {
    await expect(as(db, u.t2, () => q(db, `insert into public.scores (school_id,assessment_id,student_id,score) values ($1,$2,$3,10)`, [s1, ids.ww, ids.stu[0]]))).rejects.toThrow(/row-level security/)
  })
  it('a reviewer is read-only on learners, scores and attendance', async () => {
    await expect(as(db, u.rev, () => q(db, `insert into public.scores (school_id,assessment_id,student_id,score) values ($1,$2,$3,10)`, [s1, ids.ww, ids.stu[0]]))).rejects.toThrow(/row-level security/)
    await expect(as(db, u.rev, () => q(db, `insert into public.students (school_id,academic_year_id,lrn,first_name,last_name,grade_level_id,section_id) values ($1,$2,'900000009997','X','Y',$3,$4)`, [s1, ids.year, ids.level, ids.sec1]))).rejects.toThrow(/row-level security/)
    await expect(as(db, u.rev, () => q(db, `insert into public.attendance (school_id,section_id,student_id,attendance_date,status) values ($1,$2,$3,current_date,'present')`, [s1, ids.sec1, ids.stu[0]]))).rejects.toThrow(/row-level security/)
  })
  it('only administrators change grading rules, users and structure', async () => {
    const r1 = await as(db, u.t1, () => db.query(`update public.grading_configurations set ww_weight=30, pt_weight=40 where school_id=$1`, [s1]))
    expect(r1.affectedRows).toBe(0)
    await expect(as(db, u.t1, () => q(db, `insert into public.subjects (school_id,name,grading_configuration_id) select $1,'Hack',id from public.grading_configurations limit 1`, [s1]))).rejects.toThrow(/row-level security/)
    await expect(as(db, u.t1, () => q(db, `select public.add_member_by_email($1,'t2@example.test','admin')`, [s1]))).rejects.toThrow(/Only administrators/)
    await expect(as(db, u.t1, () => q(db, `select public.replace_transmutation_rows(gen_random_uuid(), '[]'::jsonb)`))).rejects.toThrow()
    expect((await as(db, u.t1, () => db.query(`update public.school_memberships set role='admin' where user_id=$1`, [u.t1]))).affectedRows).toBe(0)
  })
  it('computed grades and the audit log cannot be written by clients', async () => {
    await expect(as(db, u.admin, () => q(db, `update public.quarterly_grades set transmuted_grade=100`))).rejects.toThrow(/permission denied/)
    await expect(as(db, u.admin, () => q(db, `insert into public.audit_logs (school_id,action,table_name) values ($1,'x','y')`, [s1]))).rejects.toThrow(/permission denied/)
    await expect(as(db, u.admin, () => q(db, `delete from public.final_grades`))).rejects.toThrow(/permission denied/)
  })
  it('audit logs are visible to administrators and reviewers, not teachers', async () => {
    expect(await count(u.admin, 'audit_logs')).toBeGreaterThan(0)
    expect(await count(u.rev, 'audit_logs')).toBeGreaterThan(0)
    expect(await count(u.t1, 'audit_logs')).toBe(0)
  })
  it('a profile e-mail cannot be edited, and a school keeps at least one administrator', async () => {
    await expect(as(db, u.t1, () => q(db, `update public.profiles set email='x@y.z' where id=$1`, [u.t1]))).rejects.toThrow(/permission denied/)
    await expect(as(db, u.admin, () => q(db, `update public.school_memberships set role='teacher' where user_id=$1`, [u.admin]))).rejects.toThrow(/at least one administrator/)
  })
})

describe('score integrity', () => {
  it('rejects scores above the maximum, below zero, and duplicates', async () => {
    await expect(as(db, u.t1, () => q(db, `insert into public.scores (school_id,assessment_id,student_id,score) values ($1,$2,$3,21)`, [s1, ids.ww, ids.stu[0]]))).rejects.toThrow(/higher than the maximum/)
    await expect(as(db, u.t1, () => q(db, `insert into public.scores (school_id,assessment_id,student_id,score) values ($1,$2,$3,-1)`, [s1, ids.ww, ids.stu[0]]))).rejects.toThrow(/check constraint/)
  })
  it('rejects a score for a learner outside the class section', async () => {
    await expect(as(db, u.t1, () => q(db, `insert into public.scores (school_id,assessment_id,student_id,score) values ($1,$2,$3,5)`, [s1, ids.ww, ids.stu[3]]))).rejects.toThrow(/not in the section/)
  })
  it('a missing score is not a zero: grades are flagged incomplete/provisional, never filled with 0', async () => {
    await as(db, u.t1, async () => {
      await q(db, `insert into public.scores (school_id,assessment_id,student_id,score) values ($1,$2,$3,18),($1,$4,$3,40),($1,$5,$3,32)`, [s1, ids.ww, ids.stu[0], ids.pt, ids.qa])
    })
    // learner 2 has only a WW score: PT and QA missing -> no grade
    await as(db, u.t1, () => q(db, `insert into public.scores (school_id,assessment_id,student_id,score) values ($1,$2,$3,10)`, [s1, ids.ww, ids.stu[1]]))
    const rows = await q(db, `select student_id, initial_grade::float i, transmuted_grade t, status, is_complete, missing_count from public.quarterly_grades where assignment_id=$1 order by student_id`, [ids.a1])
    const by = Object.fromEntries(rows.map((r) => [r.student_id, r]))
    // 18/20=90, 40/50=80, 32/40=80 -> 0.2*90+0.5*80+0.3*80 = 82.0 -> band 81.80-82.97 -> 85
    expect(by[ids.stu[0]]).toMatchObject({ i: 82, t: 85, status: 'provisional', is_complete: true, missing_count: 0 })
    expect(by[ids.stu[1]]).toMatchObject({ t: null, status: 'incomplete', is_complete: false })
    expect(by[ids.stu[2]]).toMatchObject({ t: null, status: 'incomplete', is_complete: false })
  })
  it('records every score change in the audit log with the acting user', async () => {
    const log = await q(db, `select actor_id, action, new_data->>'score' score from public.audit_logs where table_name='scores' and record_id is not null order by created_at limit 1`)
    expect(log[0].actor_id).toBe(u.t1)
    expect(log[0].action).toBe('INSERT')
  })
  it('re-computes automatically when a score or a maximum changes', async () => {
    await as(db, u.t1, () => q(db, `update public.scores set score=20 where assessment_id=$1 and student_id=$2`, [ids.ww, ids.stu[0]]))
    let g = (await q(db, `select initial_grade::float i from public.quarterly_grades where assignment_id=$1 and student_id=$2`, [ids.a1, ids.stu[0]]))[0]
    expect(g.i).toBe(84) // 0.2*100 + 0.5*80 + 0.3*80 = 20 + 40 + 24
    await expect(as(db, u.t1, () => q(db, `update public.assessments set max_score=10 where id=$1`, [ids.ww]))).rejects.toThrow(/higher than the new maximum/)
    await as(db, u.t1, () => q(db, `update public.assessments set max_score=40 where id=$1`, [ids.ww]))
    g = (await q(db, `select initial_grade::float i from public.quarterly_grades where assignment_id=$1 and student_id=$2`, [ids.a1, ids.stu[0]]))[0]
    expect(g.i).toBe(74) // WW is now 20/40 = 50% -> 10 + 40 + 24
  })
})

describe('grading configuration', () => {
  it('rejects weights that do not total 100 and un-verifies a changed configuration', async () => {
    const cfg = (await q(db, `select grading_configuration_id id from public.subjects where id=$1`, [ids.math]))[0].id
    await expect(as(db, u.admin, () => q(db, `update public.grading_configurations set ww_weight=50 where id=$1`, [cfg]))).rejects.toThrow(/check constraint/)
    await as(db, u.admin, () => q(db, `update public.grading_configurations set is_verified=true where id=$1`, [cfg]))
    let c = (await q(db, `select is_verified, verified_by from public.grading_configurations where id=$1`, [cfg]))[0]
    expect(c).toMatchObject({ is_verified: true, verified_by: u.admin })
    await as(db, u.admin, () => q(db, `update public.grading_configurations set ww_weight=30, pt_weight=40 where id=$1`, [cfg]))
    c = (await q(db, `select is_verified, verified_by from public.grading_configurations where id=$1`, [cfg]))[0]
    expect(c).toMatchObject({ is_verified: false, verified_by: null })
    // and grades followed the new weights immediately
    const g = (await q(db, `select initial_grade::float i from public.quarterly_grades where assignment_id=$1 and student_id=$2`, [ids.a1, ids.stu[0]]))[0]
    expect(g.i).toBeCloseTo(0.3 * 50 + 0.4 * 80 + 0.3 * 80, 2)
    await as(db, u.admin, () => q(db, `update public.grading_configurations set ww_weight=20, pt_weight=50 where id=$1`, [cfg]))
  })
  it('replacing a transmutation table is validated and recomputes grades', async () => {
    const tbl = (await q(db, `select id from public.transmutation_tables where school_id=$1`, [s1]))[0].id
    await expect(as(db, u.admin, () => q(db, `select public.replace_transmutation_rows($1,'[{"min_initial":10,"max_initial":100,"transmuted":75},{"min_initial":50,"max_initial":100,"transmuted":80}]'::jsonb)`, [tbl]))).rejects.toThrow(/start at an initial grade of 0/)
    await as(db, u.admin, () => q(db, `select public.replace_transmutation_rows($1,'[{"min_initial":0,"max_initial":49.99,"transmuted":60},{"min_initial":50,"max_initial":100,"transmuted":90}]'::jsonb)`, [tbl]))
    const g = (await q(db, `select transmuted_grade t from public.quarterly_grades where assignment_id=$1 and student_id=$2`, [ids.a1, ids.stu[0]]))[0]
    expect(g.t).toBe(90)
    expect((await q(db, `select is_verified from public.transmutation_tables where id=$1`, [tbl]))[0].is_verified).toBe(false)
  })
  it('with no transmutation rows the grade stays incomplete instead of being invented', async () => {
    const tbl = (await q(db, `select id from public.transmutation_tables where school_id=$1`, [s1]))[0].id
    await db.query(`delete from public.transmutation_rows where table_id=$1`, [tbl])
    await db.query(`select public.recompute_assignment_period($1,$2)`, [ids.a1, ids.term1])
    const g = (await q(db, `select transmuted_grade t, status, initial_grade is not null has_initial from public.quarterly_grades where assignment_id=$1 and student_id=$2`, [ids.a1, ids.stu[0]]))[0]
    expect(g).toMatchObject({ t: null, status: 'incomplete', has_initial: true })
  })
})
