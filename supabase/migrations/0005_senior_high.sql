-- =====================================================================
-- 0005  Senior High School (Grades 11 and 12)
--   * grade levels 11 and 12 (added for every school, existing and new)
--   * strand on sections (STEM, ABM, HUMSS, GAS, TVL ...)
--   * semester on teacher assignments: an SHS subject runs for one
--     semester (2 quarters) and its final grade is the average of those 2
--   * default SHS grading rules, flagged NOT VERIFIED like all other rules
-- =====================================================================

-- 1. Grade levels 7 to 12 -------------------------------------------------
alter table public.grade_levels drop constraint if exists grade_levels_level_check;
alter table public.grade_levels add constraint grade_levels_level_check check (level between 7 and 12);

insert into public.grade_levels (school_id, level, name)
select s.id, g, 'Grade ' || g
from public.schools s cross join generate_series(11, 12) g
on conflict (school_id, level) do nothing;

-- bootstrap_school inserts 7-10; this trigger adds 11-12 for every new school
create or replace function public.trg_school_shs_levels()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.grade_levels (school_id, level, name)
  select new.id, g, 'Grade ' || g from generate_series(11, 12) g
  on conflict (school_id, level) do nothing;
  return null;
end $$;

drop trigger if exists schools_shs_levels on public.schools;
create trigger schools_shs_levels after insert on public.schools
  for each row execute function public.trg_school_shs_levels();

-- 2. Strand on sections ---------------------------------------------------
alter table public.sections add column if not exists strand text
  check (strand is null or length(trim(strand)) between 1 and 40);

-- 3. Semester on teacher assignments --------------------------------------
-- null = whole school year (Grades 7-10). 1 = quarters 1-2, 2 = quarters 3-4.
alter table public.teacher_assignments add column if not exists semester smallint
  check (semester is null or semester in (1, 2));

create or replace function public.recompute_final_grade(p_assignment uuid, p_student uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_school uuid; v_terms integer; v_pass smallint; v_sem smallint;
  v_first integer; v_last integer; v_need integer;
  t1 smallint; t2 smallint; t3 smallint; t4 smallint;
  v_n integer; v_nfin integer; v_napp integer;
  v_final smallint; v_remarks text; v_status public.grade_status;
begin
  select ta.school_id, ay.term_count, gc.passing_grade, ta.semester
    into v_school, v_terms, v_pass, v_sem
  from public.teacher_assignments ta
  join public.academic_years ay on ay.id = ta.academic_year_id
  join public.subjects s on s.id = ta.subject_id
  join public.grading_configurations gc on gc.id = s.grading_configuration_id
  where ta.id = p_assignment;
  if not found then return; end if;

  -- the periods that count for this subject: the whole year, or one semester (2 quarters)
  if v_sem is null or v_terms <> 4 then
    v_first := 1; v_last := v_terms;
  else
    v_first := (v_sem - 1) * 2 + 1; v_last := v_first + 1;
  end if;
  v_need := v_last - v_first + 1;

  select max(qg.transmuted_grade) filter (where gp.term_no = 1),
         max(qg.transmuted_grade) filter (where gp.term_no = 2),
         max(qg.transmuted_grade) filter (where gp.term_no = 3),
         max(qg.transmuted_grade) filter (where gp.term_no = 4),
         count(*) filter (where qg.transmuted_grade is not null and gp.term_no between v_first and v_last),
         count(*) filter (where qg.transmuted_grade is not null and gp.term_no between v_first and v_last
                          and qg.status in ('finalized', 'approved')),
         count(*) filter (where qg.transmuted_grade is not null and gp.term_no between v_first and v_last
                          and qg.status = 'approved')
    into t1, t2, t3, t4, v_n, v_nfin, v_napp
  from public.quarterly_grades qg
  join public.grading_periods gp on gp.id = qg.grading_period_id
  where qg.assignment_id = p_assignment and qg.student_id = p_student;

  if v_n = 0 then
    delete from public.final_grades where assignment_id = p_assignment and student_id = p_student;
    return;
  end if;

  if v_n = v_need then
    -- final grade = average of the counted term grades, rounded to a whole number (.5 rounds up)
    v_final := round((
      case when 1 between v_first and v_last then coalesce(t1, 0) else 0 end +
      case when 2 between v_first and v_last then coalesce(t2, 0) else 0 end +
      case when 3 between v_first and v_last then coalesce(t3, 0) else 0 end +
      case when 4 between v_first and v_last then coalesce(t4, 0) else 0 end
    )::numeric / v_need)::smallint;
    v_remarks := case when v_final >= v_pass then 'Passed' else 'Failed' end;
    v_status := case when v_napp = v_need then 'approved'
                     when v_nfin = v_need then 'finalized'
                     else 'provisional' end;
  else
    v_final := null; v_remarks := null; v_status := 'incomplete';
  end if;

  insert into public.final_grades (school_id, assignment_id, student_id, term1, term2, term3, term4,
                                   final_grade, remarks, status, computed_at)
  values (v_school, p_assignment, p_student, t1, t2, t3, t4, v_final, v_remarks, v_status, now())
  on conflict (assignment_id, student_id) do update set
    term1 = excluded.term1, term2 = excluded.term2, term3 = excluded.term3, term4 = excluded.term4,
    final_grade = excluded.final_grade, remarks = excluded.remarks,
    status = excluded.status, computed_at = now();
end $$;

-- changing the semester of an assignment recomputes its final grades
create or replace function public.trg_assignment_semester()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select distinct student_id from public.quarterly_grades where assignment_id = new.id loop
    perform public.recompute_final_grade(new.id, r.student_id);
  end loop;
  return null;
end $$;

drop trigger if exists assignment_semester_recompute on public.teacher_assignments;
create trigger assignment_semester_recompute after update of semester on public.teacher_assignments
  for each row when (old.semester is distinct from new.semester)
  execute function public.trg_assignment_semester();

-- 4. Default SHS grading rules (UNVERIFIED) --------------------------------
create or replace function public.seed_shs_grading(p_school uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_table uuid; v_src text;
begin
  if exists (select 1 from public.transmutation_tables t
             where t.school_id = p_school and t.name like 'SHS transmutation table%') then
    return;
  end if;

  v_src := 'DepEd Order No. 8, s. 2015 (Policy Guidelines on Classroom Assessment for the K to 12 Basic Education Program), '
        || 'Senior High School. Entered from general knowledge. NOT yet verified against the official issuance, '
        || 'and check whether a later DepEd Order changed it.';

  insert into public.transmutation_tables (school_id, name, policy_source, policy_version, notes, is_verified)
  values (p_school, 'SHS transmutation table (DO 8 s. 2015)', v_src, 'DO 8 s. 2015',
          'Compare every row with the official table, correct any difference, then mark verified. Initial grade 60 transmutes to 75.',
          false)
  returning id into v_table;

  -- 60 -> 75; below 60 climbs 1 per 4 points; above 60 climbs 1 per 1.6 points; 100 -> 100
  insert into public.transmutation_rows (school_id, table_id, min_initial, max_initial, transmuted)
  select p_school, v_table, t.mn, coalesce(lead(t.mn) over (order by t.mn) - 0.01, 100), t.g
  from (
    select ((g - 60) * 4)::numeric(5, 2) as mn, g from generate_series(60, 74) g
    union all select 60.00::numeric(5, 2), 75
    union all select (60 + (g - 75) * 1.6)::numeric(5, 2), g from generate_series(76, 99) g
    union all select 100.00::numeric(5, 2), 100
  ) as t;

  insert into public.grading_configurations
    (school_id, name, policy_source, policy_version, ww_weight, pt_weight, qa_weight,
     transmutation_table_id, is_verified)
  values
    (p_school, 'SHS Core and Academic subjects (25/45/30)', v_src, 'DO 8 s. 2015', 25, 45, 30, v_table, false),
    (p_school, 'SHS Technical-Vocational and Specialized (20/60/20)', v_src, 'DO 8 s. 2015', 20, 60, 20, v_table, false);
end $$;

select public.seed_shs_grading(s.id) from public.schools s;

-- new schools: bootstrap_school calls seed_default_grading last, so hook the SHS rules there
create or replace function public.seed_default_grading(p_school uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_table uuid; v_core uuid; v_perf uuid; v_src text;
begin
  v_src := 'DepEd Order No. 015, s. 2026 (Revised Guidelines on Classroom Assessment, Grading System and Awards and Recognition). '
        || 'Values transcribed from third-party summaries. NOT yet verified against the official issuance.';

  insert into public.transmutation_tables (school_id, name, policy_source, policy_version, notes, is_verified)
  values (p_school, 'SY 2026-2027 adjusted table (DO 015 s. 2026)', v_src, 'SY 2026-2027',
          'Compare every row with the official annex, correct any difference, then mark verified. Initial grade 70.00 transmutes to 75. From SY 2027-2028 the order removes transmutation: use zero-based mode.',
          false)
  returning id into v_table;

  insert into public.transmutation_rows (school_id, table_id, min_initial, max_initial, transmuted)
  select p_school, v_table, t.mn, coalesce(lead(t.mn) over (order by t.mn) - 0.01, 100), t.g
  from (values
    (0.00, 60), (4.68, 61), (9.35, 62), (14.01, 63), (18.68, 64), (23.35, 65), (28.01, 66),
    (32.68, 67), (37.34, 68), (42.01, 69), (46.67, 70), (51.34, 71), (56.01, 72), (60.67, 73),
    (65.34, 74), (70.00, 75), (71.18, 76), (72.36, 77), (73.54, 78), (74.72, 79), (75.90, 80),
    (77.08, 81), (78.26, 82), (79.44, 83), (80.62, 84), (81.80, 85), (82.98, 86), (84.16, 87),
    (85.34, 88), (86.52, 89), (87.70, 90), (88.88, 91), (90.06, 92), (91.24, 93), (92.42, 94),
    (93.60, 95), (94.78, 96), (95.96, 97), (97.14, 98), (98.32, 99), (99.50, 100)
  ) as t(mn, g);

  insert into public.grading_configurations
    (school_id, name, policy_source, policy_version, ww_weight, pt_weight, qa_weight,
     transmutation_table_id, is_verified)
  values (p_school, 'Core learning areas (20/50/30)', v_src, 'DO 015 s. 2026', 20, 50, 30, v_table, false)
  returning id into v_core;

  insert into public.grading_configurations
    (school_id, name, policy_source, policy_version, ww_weight, pt_weight, qa_weight,
     transmutation_table_id, is_verified)
  values (p_school, 'TLE and MAPEH (20/60/20)', v_src, 'DO 015 s. 2026', 20, 60, 20, v_table, false)
  returning id into v_perf;

  insert into public.subjects (school_id, name, learning_area, grading_configuration_id, sort_order) values
    (p_school, 'Filipino', 'Languages', v_core, 1),
    (p_school, 'English', 'Languages', v_core, 2),
    (p_school, 'Mathematics', 'Mathematics', v_core, 3),
    (p_school, 'Science', 'Science', v_core, 4),
    (p_school, 'Araling Panlipunan', 'Social Studies', v_core, 5),
    (p_school, 'Values Education (EsP / GMRC)', 'Values Education', v_core, 6),
    (p_school, 'Technology and Livelihood Education', 'TLE', v_perf, 7),
    (p_school, 'MAPEH', 'MAPEH', v_perf, 8);

  perform public.seed_shs_grading(p_school);
end $$;

