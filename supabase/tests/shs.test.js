import { describe, it, expect, beforeAll } from 'vitest'
import { createDb, addUser, as, q } from './harness.js'

let db, admin, school, year, terms

beforeAll(async () => {
  db = await createDb()
  admin = await addUser(db, 'shs-admin@example.test')
  school = (await as(db, admin, () => q(db, `select public.bootstrap_school('SHS School', null, 4) id`)))[0].id
  year = (await q(db, `select id from public.academic_years where school_id=$1`, [school]))[0].id
  terms = (await q(db, `select id from public.grading_periods where school_id=$1 order by term_no`, [school])).map((t) => t.id)
}, 180000)

describe('Senior High School structure', () => {
  it('offers grade levels 7 to 12 and rejects anything else', async () => {
    const levels = (await q(db, `select level from public.grade_levels where school_id=$1 order by level`, [school])).map((r) => r.level)
    expect(levels).toEqual([7, 8, 9, 10, 11, 12])
    await expect(q(db, `insert into public.grade_levels (school_id, level, name) values ($1, 13, 'Grade 13')`, [school])).rejects.toThrow()
  })

  it('seeds the SHS transmutation table (60 -> 75, 100 -> 100) and two unverified SHS configurations', async () => {
    const t = (await q(db, `select id, is_verified from public.transmutation_tables where school_id=$1 and name like 'SHS%'`, [school]))[0]
    expect(t.is_verified).toBe(false)
    const grade = async (x) => (await q(db, `select transmuted from public.transmutation_rows where table_id=$1 and $2::numeric between min_initial and max_initial`, [t.id, x]))[0]?.transmuted
    expect(await grade(0)).toBe(60)
    expect(await grade(59.99)).toBe(74)
    expect(await grade(60)).toBe(75)
    expect(await grade(61.59)).toBe(75)
    expect(await grade(61.6)).toBe(76)
    expect(await grade(90)).toBe(93)
    expect(await grade(98.4)).toBe(99)
    expect(await grade(100)).toBe(100)
    const cfgs = await q(db, `select ww_weight, pt_weight, qa_weight, is_verified from public.grading_configurations where school_id=$1 and name like 'SHS%'`, [school])
    expect(cfgs).toHaveLength(2)
    expect(cfgs.every((c) => c.is_verified === false)).toBe(true)
  })
})

describe('semester final grades', () => {
  let a1, a2, stu

  beforeAll(async () => {
    const lvl = (await q(db, `select id from public.grade_levels where school_id=$1 and level=11`, [school]))[0].id
    const sec = (await q(db, `insert into public.sections (school_id, academic_year_id, grade_level_id, name, strand) values ($1,$2,$3,'Rizal','STEM') returning id`, [school, year, lvl]))[0].id
    stu = (await q(db, `insert into public.students (school_id, academic_year_id, lrn, first_name, last_name, grade_level_id, section_id)
                        values ($1,$2,'900000000001','Fictional','Learner',$3,$4) returning id`, [school, year, lvl, sec]))[0].id
    const cfg = (await q(db, `select id from public.grading_configurations where school_id=$1 and name like 'SHS Core%'`, [school]))[0].id
    const subj = async (n) => (await q(db, `insert into public.subjects (school_id, name, grading_configuration_id) values ($1,$2,$3) returning id`, [school, n, cfg]))[0].id
    const assign = async (subject, sem) => (await q(db, `insert into public.teacher_assignments (school_id, academic_year_id, section_id, subject_id, teacher_id, semester)
                                                          values ($1,$2,$3,$4,$5,$6) returning id`, [school, year, sec, subject, admin, sem]))[0].id
    a1 = await assign(await subj('General Mathematics'), 1)
    a2 = await assign(await subj('Oral Communication (full-year test)'), null)
    const score = async (a, term, pts) => {
      for (const cat of ['WW', 'PT', 'QA']) {
        const id = (await q(db, `insert into public.assessments (school_id,assignment_id,grading_period_id,category,title,max_score) values ($1,$2,$3,$4::public.assessment_category,$4::text||' task',10) returning id`, [school, a, term, cat]))[0].id
        await q(db, `insert into public.scores (school_id,assessment_id,student_id,score) values ($1,$2,$3,$4)`, [school, id, stu, pts])
      }
    }
    await score(a1, terms[0], 9) // 90% -> 93
    await score(a1, terms[1], 8) // 80% -> 87
    await score(a2, terms[0], 9)
    await score(a2, terms[1], 8)
  }, 120000)

  it('a semester subject finalizes from its two quarters only', async () => {
    const r = (await q(db, `select term1, term2, term3, term4, final_grade, remarks, status from public.final_grades where assignment_id=$1 and student_id=$2`, [a1, stu]))[0]
    expect([r.term1, r.term2]).toEqual([93, 87])
    expect(r.term3).toBeNull()
    expect(r.term4).toBeNull()
    expect(r.final_grade).toBe(90) // (93 + 87) / 2
    expect(r.remarks).toBe('Passed')
    expect(r.status).toBe('provisional')
  })

  it('a whole-year subject with only two quarters stays incomplete', async () => {
    const r = (await q(db, `select final_grade, status from public.final_grades where assignment_id=$1 and student_id=$2`, [a2, stu]))[0]
    expect(r.final_grade).toBeNull()
    expect(r.status).toBe('incomplete')
  })

  it('changing the semester recomputes the final grade', async () => {
    await q(db, `update public.teacher_assignments set semester=2 where id=$1`, [a1])
    // quarters 3-4 have no grades yet, so there is no final grade row at all
    expect(await q(db, `select 1 from public.final_grades where assignment_id=$1 and student_id=$2`, [a1, stu])).toHaveLength(0)
    await q(db, `update public.teacher_assignments set semester=1 where id=$1`, [a1])
    expect((await q(db, `select final_grade from public.final_grades where assignment_id=$1 and student_id=$2`, [a1, stu]))[0].final_grade).toBe(90)
  })

  it('rejects an invalid semester', async () => {
    await expect(q(db, `update public.teacher_assignments set semester=3 where id=$1`, [a1])).rejects.toThrow()
  })
})
