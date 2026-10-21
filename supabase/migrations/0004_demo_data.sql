-- =====================================================================
-- Classroom Gradebook - 0004 fictional demo data
--
-- seed_demo_data(school)  adds FICTIONAL learners, one demo class, assessments,
--                         scores and attendance for the current school year.
-- remove_demo_data(school) removes everything it created.
--
-- Demo learners are clearly marked: middle name 'DEMO', LRNs start with 9000000,
-- section names start with 'Demo '. No real student data is used.
-- =====================================================================

create or replace function public.seed_demo_data(p_school uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_teacher uuid; v_year uuid; v_period uuid; v_level uuid;
  v_first text[] := array['Juan', 'Maria', 'Jose', 'Ana', 'Pedro', 'Luz', 'Carlo', 'Mika', 'Rico', 'Bea', 'Nico', 'Tess'];
  v_last text[] := array['Dela Cruz', 'Santos', 'Reyes', 'Garcia', 'Ramos', 'Mendoza', 'Torres', 'Flores', 'Rivera', 'Aquino', 'Bautista', 'Castillo'];
  v_sec uuid; v_ass uuid; v_asm uuid; v_stu uuid;
  v_subject record; v_student record;
  v_sec_names text[] := array['Demo Narra', 'Demo Molave'];
  v_n_students integer := 0; v_n_scores integer := 0; v_n_att integer := 0;
  i integer; s integer; a integer; d integer; v_max numeric; v_ratio numeric; v_date date;
  v_titles text[] := array['Quiz 1', 'Quiz 2', 'Seatwork', 'Project', 'Group Task', 'Lab Report', 'Summative Test 1', 'Summative Test 2', 'Term Examination'];
  v_cats public.assessment_category[] := array['WW', 'WW', 'WW', 'PT', 'PT', 'PT', 'QA', 'QA', 'QA']::public.assessment_category[];
  v_maxes numeric[] := array[20, 25, 30, 50, 50, 100, 40, 40, 60];
  v_weights numeric[] := array[null, null, null, null, null, null, 30, 30, 40];
  v_stat public.attendance_status;
begin
  if v_uid is not null and not public.is_school_admin(p_school) then
    raise exception 'Only administrators can load demo data';
  end if;
  v_teacher := coalesce(v_uid, (select m.user_id from public.school_memberships m
                                where m.school_id = p_school and m.role = 'admin' limit 1));
  if v_teacher is null then raise exception 'School has no administrator'; end if;

  select ay.id into v_year from public.academic_years ay where ay.school_id = p_school and ay.is_current;
  if v_year is null then raise exception 'Create a current school year first'; end if;
  select gp.id into v_period from public.grading_periods gp
    where gp.academic_year_id = v_year and gp.term_no = 1;
  select gl.id into v_level from public.grade_levels gl where gl.school_id = p_school and gl.level = 7;

  for s in 1 .. 2 loop
    insert into public.sections (school_id, academic_year_id, grade_level_id, name)
    values (p_school, v_year, v_level, v_sec_names[s])
    on conflict (academic_year_id, grade_level_id, name) do nothing;
    select sec.id into v_sec from public.sections sec
      where sec.academic_year_id = v_year and sec.grade_level_id = v_level and sec.name = v_sec_names[s];

    for i in 1 .. 12 loop
      insert into public.students (school_id, academic_year_id, lrn, first_name, middle_name, last_name,
                                   sex, grade_level_id, section_id, status)
      values (p_school, v_year, '9000000' || lpad((s * 100 + i)::text, 5, '0'),
              v_first[i], 'DEMO', v_last[((i + s * 3 - 1) % 12) + 1],
              case when i % 2 = 0 then 'Female' else 'Male' end, v_level, v_sec, 'enrolled')
      on conflict (school_id, academic_year_id, lrn) do nothing;
      if found then v_n_students := v_n_students + 1; end if;
    end loop;

    -- three demo classes per section: Mathematics, Science, English
    for v_subject in select sub.id, sub.name from public.subjects sub
                     where sub.school_id = p_school and sub.name in ('Mathematics', 'Science', 'English') loop
      insert into public.teacher_assignments (school_id, academic_year_id, section_id, subject_id, teacher_id)
      values (p_school, v_year, v_sec, v_subject.id, v_teacher)
      on conflict (academic_year_id, section_id, subject_id) do nothing;
      select ta.id into v_ass from public.teacher_assignments ta
        where ta.academic_year_id = v_year and ta.section_id = v_sec and ta.subject_id = v_subject.id;

      if not exists (select 1 from public.assessments x where x.assignment_id = v_ass and x.grading_period_id = v_period) then
        for a in 1 .. 9 loop
          insert into public.assessments (school_id, assignment_id, grading_period_id, category, title,
                                          assessment_date, max_score, weight)
          values (p_school, v_ass, v_period, v_cats[a], v_titles[a], current_date - (30 - a * 3),
                  v_maxes[a], v_weights[a])
          returning id into v_asm;

          for v_student in select st.id, row_number() over (order by st.lrn) as rn
                           from public.students st where st.section_id = v_sec loop
            -- leave a few scores missing on purpose so the "incomplete" flow is visible
            if (v_student.rn % 7 = 0 and a = 6) or (v_student.rn % 11 = 0 and a = 9) then
              continue;
            end if;
            v_max := v_maxes[a];
            v_ratio := 0.55 + (((v_student.rn * 37 + a * 17 + s * 11) % 40) / 100.0);
            insert into public.scores (school_id, assessment_id, student_id, score)
            values (p_school, v_asm, v_student.id, least(v_max, round(v_max * v_ratio)));
            v_n_scores := v_n_scores + 1;
          end loop;
        end loop;
      end if;
    end loop;

    -- attendance for the last five weekdays
    d := 0;
    v_date := current_date;
    while d < 5 loop
      if extract(isodow from v_date) < 6 then
        for v_student in select st.id, row_number() over (order by st.lrn) as rn
                         from public.students st where st.section_id = v_sec loop
          v_stat := case ((v_student.rn * 5 + extract(day from v_date)::integer) % 13)
                      when 0 then 'absent' when 1 then 'late' when 2 then 'excused' else 'present' end;
          insert into public.attendance (school_id, section_id, student_id, attendance_date, status)
          values (p_school, v_sec, v_student.id, v_date, v_stat)
          on conflict (student_id, attendance_date) do nothing;
          if found then v_n_att := v_n_att + 1; end if;
        end loop;
        d := d + 1;
      end if;
      v_date := v_date - 1;
    end loop;
  end loop;

  return jsonb_build_object('students', v_n_students, 'scores', v_n_scores, 'attendance', v_n_att);
end $$;

create or replace function public.remove_demo_data(p_school uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_a integer; v_s integer; v_sec integer;
begin
  if auth.uid() is not null and not public.is_school_admin(p_school) then
    raise exception 'Only administrators can remove demo data';
  end if;
  -- demo classes first (cascades assessments, scores and computed grades)
  delete from public.teacher_assignments ta
   using public.sections s
   where ta.section_id = s.id and s.school_id = p_school and s.name like 'Demo %';
  get diagnostics v_a = row_count;
  delete from public.students where school_id = p_school and middle_name = 'DEMO';
  get diagnostics v_s = row_count;
  delete from public.sections s
   where s.school_id = p_school and s.name like 'Demo %'
     and not exists (select 1 from public.students st where st.section_id = s.id);
  get diagnostics v_sec = row_count;
  return jsonb_build_object('assignments', v_a, 'students', v_s, 'sections', v_sec);
end $$;

revoke all on function public.seed_demo_data(uuid) from public, anon, authenticated;
revoke all on function public.remove_demo_data(uuid) from public, anon, authenticated;
grant execute on function public.seed_demo_data(uuid) to authenticated;
grant execute on function public.remove_demo_data(uuid) to authenticated;
