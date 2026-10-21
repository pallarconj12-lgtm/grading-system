-- =====================================================================
-- Classroom Gradebook - 0002 functions, grade engine, triggers, RPCs
-- All SECURITY DEFINER functions pin search_path and re-check authorization.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Profiles are created automatically for every auth user
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), new.email)
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (id, full_name, email)
select u.id, coalesce(u.raw_user_meta_data ->> 'full_name', ''), u.email from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Authorization helpers (used by RLS policies and RPCs)
-- ---------------------------------------------------------------------
create or replace function public.is_school_member(p_school uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.school_memberships m
                 where m.school_id = p_school and m.user_id = auth.uid());
$$;

create or replace function public.has_school_role(p_school uuid, p_roles public.app_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.school_memberships m
                 where m.school_id = p_school and m.user_id = auth.uid() and m.role = any (p_roles));
$$;

create or replace function public.is_school_admin(p_school uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_school_role(p_school, array['admin']::public.app_role[]);
$$;

create or replace function public.shares_school_with(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.school_memberships me
    join public.school_memberships other on other.school_id = me.school_id
    where me.user_id = auth.uid() and other.user_id = p_user);
$$;

create or replace function public.teaches_section(p_section uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.teacher_assignments ta
                 where ta.section_id = p_section and ta.teacher_id = auth.uid());
$$;

create or replace function public.advises_section(p_section uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sections s
                 where s.id = p_section and s.adviser_id = auth.uid());
$$;

-- Read: administrators, reviewers, the adviser, or any teacher assigned to the section.
create or replace function public.can_read_section(p_section uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.sections s
    where s.id = p_section
      and (public.has_school_role(s.school_id, array['admin', 'reviewer']::public.app_role[])
           or s.adviser_id = auth.uid()
           or exists (select 1 from public.teacher_assignments ta
                      where ta.section_id = s.id and ta.teacher_id = auth.uid())));
$$;

-- Write (learners, attendance): administrators, the adviser, or an assigned teacher. Never reviewers.
create or replace function public.can_write_section(p_section uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.sections s
    where s.id = p_section
      and (public.is_school_admin(s.school_id)
           or s.adviser_id = auth.uid()
           or exists (select 1 from public.teacher_assignments ta
                      where ta.section_id = s.id and ta.teacher_id = auth.uid())));
$$;

-- Grades of a class: administrators, reviewers, the assigned teacher, and the section adviser (read only).
create or replace function public.can_read_assignment(p_assignment uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.teacher_assignments ta
    join public.sections s on s.id = ta.section_id
    where ta.id = p_assignment
      and (public.has_school_role(ta.school_id, array['admin', 'reviewer']::public.app_role[])
           or ta.teacher_id = auth.uid()
           or s.adviser_id = auth.uid()));
$$;

create or replace function public.can_write_assignment(p_assignment uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.teacher_assignments ta
    where ta.id = p_assignment
      and (public.is_school_admin(ta.school_id) or ta.teacher_id = auth.uid()));
$$;

create or replace function public.can_read_assessment(p_assessment uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.assessments a
                 where a.id = p_assessment and public.can_read_assignment(a.assignment_id));
$$;

create or replace function public.can_write_assessment(p_assessment uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.assessments a
                 where a.id = p_assessment and public.can_write_assignment(a.assignment_id));
$$;

create or replace function public.is_period_locked(p_assignment uuid, p_period uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.quarterly_grades qg
                 where qg.assignment_id = p_assignment and qg.grading_period_id = p_period
                   and qg.status in ('finalized', 'approved'));
$$;

-- ---------------------------------------------------------------------
-- Grade engine (the JavaScript twin lives in src/lib/grading/compute.js;
-- both are exercised by the parity test in supabase/tests)
-- ---------------------------------------------------------------------
create or replace function public.compute_transmuted(p_config uuid, p_initial numeric)
returns smallint language plpgsql stable security definer set search_path = public as $$
declare
  c public.grading_configurations%rowtype;
  v smallint;
begin
  if p_initial is null then return null; end if;
  select * into c from public.grading_configurations where id = p_config;
  if not found then return null; end if;

  if c.transmutation_mode = 'zero_based' then
    -- no table: the computed grade is the term grade, with a configurable floor
    return greatest(c.minimum_reportable_grade, round(p_initial))::smallint;
  end if;

  -- table lookup: the row with the highest min_initial that is <= the initial grade.
  -- No table or no matching row => null. Never an invented value.
  select r.transmuted into v
  from public.transmutation_rows r
  where r.table_id = c.transmutation_table_id and r.min_initial <= p_initial
  order by r.min_initial desc limit 1;
  return v;
end $$;

create or replace function public.recompute_term_grade(p_assignment uuid, p_period uuid, p_student uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_school uuid;
  c public.grading_configurations%rowtype;
  comp jsonb;
  e_ww numeric; p_ww numeric; m_ww integer; pct_ww numeric;
  e_pt numeric; p_pt numeric; m_pt integer; pct_pt numeric;
  e_qa numeric; p_qa numeric; m_qa integer; pct_qa numeric;
  v_missing integer;
  v_ok boolean;
  v_initial numeric;
  v_trans smallint;
  v_complete boolean;
  v_status public.grade_status;
begin
  select ta.school_id into v_school from public.teacher_assignments ta where ta.id = p_assignment;
  if not found then return; end if;

  -- finalized and approved grades are frozen until the term is reopened
  if exists (select 1 from public.quarterly_grades qg
             where qg.assignment_id = p_assignment and qg.grading_period_id = p_period
               and qg.student_id = p_student and qg.status in ('finalized', 'approved')) then
    return;
  end if;

  select gc.* into c
  from public.teacher_assignments ta
  join public.subjects s on s.id = ta.subject_id
  join public.grading_configurations gc on gc.id = s.grading_configuration_id
  where ta.id = p_assignment;
  if not found then return; end if;

  with x as (
    select a.category, a.max_score, a.weight, s.score,
           (s.score is not null and not coalesce(s.is_excused, false)) as scored,
           (not coalesce(s.is_excused, false)) as applicable
    from public.assessments a
    left join public.scores s on s.assessment_id = a.id and s.student_id = p_student
    where a.assignment_id = p_assignment and a.grading_period_id = p_period
  ), agg as (
    select category,
           coalesce(sum(score) filter (where scored), 0) as earned,
           coalesce(sum(max_score) filter (where scored), 0) as possible,
           count(*) filter (where applicable and not scored) as missing,
           bool_and(weight is not null) as weighted,
           coalesce(sum(weight) filter (where scored), 0) as wsum,
           coalesce(sum(weight * score / max_score) filter (where scored), 0) as wscore
    from x group by category
  )
  select coalesce(jsonb_object_agg(category::text, jsonb_build_object(
           'earned', earned, 'possible', possible, 'missing', missing,
           'pct', case when weighted
                       then case when wsum > 0 then wscore / wsum * 100 end
                       else case when possible > 0 then earned / possible * 100 end end)),
         '{}'::jsonb)
  into comp from agg;

  e_ww := coalesce((comp -> 'WW' ->> 'earned')::numeric, 0);
  p_ww := coalesce((comp -> 'WW' ->> 'possible')::numeric, 0);
  m_ww := coalesce((comp -> 'WW' ->> 'missing')::integer, 0);
  pct_ww := (comp -> 'WW' ->> 'pct')::numeric;
  e_pt := coalesce((comp -> 'PT' ->> 'earned')::numeric, 0);
  p_pt := coalesce((comp -> 'PT' ->> 'possible')::numeric, 0);
  m_pt := coalesce((comp -> 'PT' ->> 'missing')::integer, 0);
  pct_pt := (comp -> 'PT' ->> 'pct')::numeric;
  e_qa := coalesce((comp -> 'QA' ->> 'earned')::numeric, 0);
  p_qa := coalesce((comp -> 'QA' ->> 'possible')::numeric, 0);
  m_qa := coalesce((comp -> 'QA' ->> 'missing')::integer, 0);
  pct_qa := (comp -> 'QA' ->> 'pct')::numeric;

  v_missing := m_ww + m_pt + m_qa;

  -- a component with a weight above zero needs at least one scored assessment
  v_ok := (c.ww_weight = 0 or pct_ww is not null)
      and (c.pt_weight = 0 or pct_pt is not null)
      and (c.qa_weight = 0 or pct_qa is not null);

  if v_ok and not (c.missing_policy = 'block' and v_missing > 0) then
    -- numeric division truncates repeating decimals (e.g. 29/36), which can leave a total that is
    -- exactly 73.825 sitting at 73.8249999... and round DOWN. A 1e-9 tolerance (the same one the
    -- JavaScript engine uses) restores true half-up rounding; real scores are never that close to a boundary.
    v_initial := round(coalesce(pct_ww, 0) * c.ww_weight / 100
                     + coalesce(pct_pt, 0) * c.pt_weight / 100
                     + coalesce(pct_qa, 0) * c.qa_weight / 100 + 0.000000001, c.initial_decimals);
    v_trans := public.compute_transmuted(c.id, v_initial);
  else
    v_initial := null;
    v_trans := null;
  end if;

  v_complete := v_ok and v_missing = 0 and v_trans is not null;
  v_status := case when v_trans is null then 'incomplete' else 'provisional' end;

  insert into public.quarterly_grades as qg (
    school_id, assignment_id, grading_period_id, student_id,
    ww_earned, ww_possible, ww_pct, pt_earned, pt_possible, pt_pct, qa_earned, qa_possible, qa_pct,
    initial_grade, transmuted_grade, status, is_complete, missing_count, computed_at)
  values (
    v_school, p_assignment, p_period, p_student,
    e_ww, p_ww, round(pct_ww, 2), e_pt, p_pt, round(pct_pt, 2), e_qa, p_qa, round(pct_qa, 2),
    v_initial, v_trans, v_status, v_complete, v_missing, now())
  on conflict (assignment_id, grading_period_id, student_id) do update set
    ww_earned = excluded.ww_earned, ww_possible = excluded.ww_possible, ww_pct = excluded.ww_pct,
    pt_earned = excluded.pt_earned, pt_possible = excluded.pt_possible, pt_pct = excluded.pt_pct,
    qa_earned = excluded.qa_earned, qa_possible = excluded.qa_possible, qa_pct = excluded.qa_pct,
    initial_grade = excluded.initial_grade, transmuted_grade = excluded.transmuted_grade,
    status = excluded.status, is_complete = excluded.is_complete,
    missing_count = excluded.missing_count, computed_at = now();

  perform public.recompute_final_grade(p_assignment, p_student);
end $$;

create or replace function public.recompute_final_grade(p_assignment uuid, p_student uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_school uuid; v_terms integer; v_pass smallint;
  t1 smallint; t2 smallint; t3 smallint; t4 smallint;
  v_n integer; v_nfin integer; v_napp integer;
  v_final smallint; v_remarks text; v_status public.grade_status;
begin
  select ta.school_id, ay.term_count, gc.passing_grade
    into v_school, v_terms, v_pass
  from public.teacher_assignments ta
  join public.academic_years ay on ay.id = ta.academic_year_id
  join public.subjects s on s.id = ta.subject_id
  join public.grading_configurations gc on gc.id = s.grading_configuration_id
  where ta.id = p_assignment;
  if not found then return; end if;

  select max(qg.transmuted_grade) filter (where gp.term_no = 1),
         max(qg.transmuted_grade) filter (where gp.term_no = 2),
         max(qg.transmuted_grade) filter (where gp.term_no = 3),
         max(qg.transmuted_grade) filter (where gp.term_no = 4),
         count(*) filter (where qg.transmuted_grade is not null and gp.term_no <= v_terms),
         count(*) filter (where qg.transmuted_grade is not null and gp.term_no <= v_terms
                          and qg.status in ('finalized', 'approved')),
         count(*) filter (where qg.transmuted_grade is not null and gp.term_no <= v_terms
                          and qg.status = 'approved')
    into t1, t2, t3, t4, v_n, v_nfin, v_napp
  from public.quarterly_grades qg
  join public.grading_periods gp on gp.id = qg.grading_period_id
  where qg.assignment_id = p_assignment and qg.student_id = p_student;

  if v_n = 0 then
    delete from public.final_grades where assignment_id = p_assignment and student_id = p_student;
    return;
  end if;

  if v_n = v_terms then
    -- final grade = average of the term grades, rounded to the nearest whole number (.5 rounds up)
    v_final := round((coalesce(t1, 0) + coalesce(t2, 0) + coalesce(t3, 0) + coalesce(t4, 0))::numeric / v_terms)::smallint;
    v_remarks := case when v_final >= v_pass then 'Passed' else 'Failed' end;
    v_status := case when v_napp = v_terms then 'approved'
                     when v_nfin = v_terms then 'finalized'
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

create or replace function public.recompute_assignment_period(p_assignment uuid, p_period uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_section uuid;
  r record;
begin
  select ta.section_id into v_section from public.teacher_assignments ta where ta.id = p_assignment;
  if not found then return; end if;
  for r in select st.id from public.students st where st.section_id = v_section loop
    perform public.recompute_term_grade(p_assignment, p_period, r.id);
  end loop;
end $$;

create or replace function public.recompute_for_config(p_config uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select distinct ta.id as assignment_id, a.grading_period_id as period_id
    from public.subjects sub
    join public.teacher_assignments ta on ta.subject_id = sub.id
    join public.assessments a on a.assignment_id = ta.id
    where sub.grading_configuration_id = p_config
  loop
    perform public.recompute_assignment_period(r.assignment_id, r.period_id);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Guards and recompute triggers
-- ---------------------------------------------------------------------
create or replace function public.trg_scores_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_row public.scores%rowtype;
  v_assignment uuid; v_period uuid; v_max numeric;
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;

  select a.assignment_id, a.grading_period_id, a.max_score
    into v_assignment, v_period, v_max
  from public.assessments a where a.id = v_row.assessment_id;

  if not found then
    -- parent assessment is already gone (cascade delete)
    if tg_op = 'DELETE' then return old; end if;
    raise exception 'Assessment not found';
  end if;

  if public.is_period_locked(v_assignment, v_period) then
    raise exception 'This term is finalized. Reopen it before changing scores.';
  end if;

  if tg_op = 'DELETE' then return old; end if;

  if new.score is not null and new.score > v_max then
    raise exception 'Score % is higher than the maximum score of %', new.score, v_max
      using errcode = 'check_violation';
  end if;

  if not exists (select 1 from public.students st
                 join public.teacher_assignments ta on ta.section_id = st.section_id
                 where st.id = new.student_id and ta.id = v_assignment) then
    raise exception 'The learner is not in the section of this assessment'
      using errcode = 'check_violation';
  end if;

  new.updated_by := auth.uid();
  return new;
end $$;

create trigger scores_guard before insert or update or delete on public.scores
  for each row execute function public.trg_scores_guard();

create or replace function public.trg_scores_recompute()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_row public.scores%rowtype;
  v_assignment uuid; v_period uuid;
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;
  select a.assignment_id, a.grading_period_id into v_assignment, v_period
  from public.assessments a where a.id = v_row.assessment_id;
  if found then
    perform public.recompute_term_grade(v_assignment, v_period, v_row.student_id);
  end if;
  return null;
end $$;

create trigger scores_recompute after insert or update or delete on public.scores
  for each row execute function public.trg_scores_recompute();

create or replace function public.trg_assessments_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ta_year uuid; v_gp_year uuid;
begin
  if tg_op = 'DELETE' then
    if public.is_period_locked(old.assignment_id, old.grading_period_id) then
      raise exception 'This term is finalized. Reopen it before deleting assessments.';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if old.assignment_id <> new.assignment_id then
      raise exception 'An assessment cannot be moved to another class';
    end if;
    if public.is_period_locked(old.assignment_id, old.grading_period_id) then
      raise exception 'This term is finalized. Reopen it before changing assessments.';
    end if;
  end if;

  if public.is_period_locked(new.assignment_id, new.grading_period_id) then
    raise exception 'This term is finalized. Reopen it before adding assessments.';
  end if;

  select ta.academic_year_id into v_ta_year from public.teacher_assignments ta where ta.id = new.assignment_id;
  select gp.academic_year_id into v_gp_year from public.grading_periods gp where gp.id = new.grading_period_id;
  if v_ta_year is distinct from v_gp_year then
    raise exception 'The term does not belong to the school year of this class';
  end if;

  if tg_op = 'UPDATE' and exists (select 1 from public.scores s
                                  where s.assessment_id = new.id and s.score > new.max_score) then
    raise exception 'Some learner scores are higher than the new maximum score';
  end if;

  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); end if;
  return new;
end $$;

create trigger assessments_guard before insert or update or delete on public.assessments
  for each row execute function public.trg_assessments_guard();

create or replace function public.trg_assessments_recompute()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.recompute_assignment_period(new.assignment_id, new.grading_period_id);
  end if;
  if tg_op = 'DELETE'
     or (tg_op = 'UPDATE' and old.grading_period_id is distinct from new.grading_period_id) then
    perform public.recompute_assignment_period(old.assignment_id, old.grading_period_id);
  end if;
  return null;
end $$;

create trigger assessments_recompute after insert or update or delete on public.assessments
  for each row execute function public.trg_assessments_recompute();

create or replace function public.trg_students_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.sections s
                 where s.id = new.section_id and s.grade_level_id = new.grade_level_id
                   and s.academic_year_id = new.academic_year_id) then
    raise exception 'The section does not match the learner''s grade level and school year'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger students_guard before insert or update on public.students
  for each row execute function public.trg_students_guard();

create or replace function public.trg_attendance_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.students st
                 where st.id = new.student_id and st.section_id = new.section_id) then
    raise exception 'The learner is not in this section' using errcode = 'check_violation';
  end if;
  new.marked_by := auth.uid();
  return new;
end $$;

create trigger attendance_guard before insert or update on public.attendance
  for each row execute function public.trg_attendance_guard();

-- Configuration changes: changing the rules un-verifies them, then re-computes every affected grade.
create or replace function public.trg_config_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.ww_weight, new.pt_weight, new.qa_weight, new.missing_policy, new.initial_decimals,
      new.transmutation_mode, new.transmutation_table_id, new.minimum_reportable_grade,
      new.passing_grade, new.policy_source, new.policy_version)
     is distinct from
     (old.ww_weight, old.pt_weight, old.qa_weight, old.missing_policy, old.initial_decimals,
      old.transmutation_mode, old.transmutation_table_id, old.minimum_reportable_grade,
      old.passing_grade, old.policy_source, old.policy_version)
     and new.is_verified is not distinct from old.is_verified then
    new.is_verified := false; new.verified_by := null; new.verified_at := null;
  end if;
  if new.is_verified and not old.is_verified then
    new.verified_by := auth.uid(); new.verified_at := now();
  elsif not new.is_verified then
    new.verified_by := null; new.verified_at := null;
  end if;
  return new;
end $$;

create trigger config_guard before update on public.grading_configurations
  for each row execute function public.trg_config_guard();

create or replace function public.trg_tables_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_verified and not old.is_verified then
    new.verified_by := auth.uid(); new.verified_at := now();
  elsif not new.is_verified then
    new.verified_by := null; new.verified_at := null;
  end if;
  return new;
end $$;

create trigger tables_guard before update on public.transmutation_tables
  for each row execute function public.trg_tables_guard();

create or replace function public.trg_config_recompute()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.recompute_for_config(new.id);
  return null;
end $$;

create trigger config_recompute after update on public.grading_configurations
  for each row
  when (old.ww_weight is distinct from new.ww_weight or old.pt_weight is distinct from new.pt_weight
        or old.qa_weight is distinct from new.qa_weight
        or old.missing_policy is distinct from new.missing_policy
        or old.initial_decimals is distinct from new.initial_decimals
        or old.transmutation_mode is distinct from new.transmutation_mode
        or old.transmutation_table_id is distinct from new.transmutation_table_id
        or old.minimum_reportable_grade is distinct from new.minimum_reportable_grade
        or old.passing_grade is distinct from new.passing_grade)
  execute function public.trg_config_recompute();

create or replace function public.trg_subject_config_recompute()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.recompute_for_config(new.grading_configuration_id);
  return null;
end $$;

create trigger subject_config_recompute after update of grading_configuration_id on public.subjects
  for each row
  when (old.grading_configuration_id is distinct from new.grading_configuration_id)
  execute function public.trg_subject_config_recompute();

create or replace function public.trg_membership_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'admin' and (tg_op = 'DELETE' or new.role <> 'admin')
     and exists (select 1 from public.schools s where s.id = old.school_id) then
    if not exists (select 1 from public.school_memberships m
                   where m.school_id = old.school_id and m.role = 'admin' and m.id <> old.id) then
      raise exception 'A school must keep at least one administrator';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create trigger membership_guard before update or delete on public.school_memberships
  for each row execute function public.trg_membership_guard();

-- ---------------------------------------------------------------------
-- Audit log (grade changes, attendance changes, finalization, rule changes)
-- ---------------------------------------------------------------------
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb; v_new jsonb; v_row jsonb;
begin
  if tg_op = 'INSERT' then v_new := to_jsonb(new);
  elsif tg_op = 'UPDATE' then v_old := to_jsonb(old); v_new := to_jsonb(new);
  else v_old := to_jsonb(old);
  end if;
  v_row := coalesce(v_new, v_old);
  insert into public.audit_logs (school_id, actor_id, action, table_name, record_id, old_data, new_data)
  values ((v_row ->> 'school_id')::uuid, auth.uid(), tg_op, tg_table_name,
          (v_row ->> 'id')::uuid, v_old, v_new);
  return null;
end $$;

create trigger audit_scores after insert or update or delete on public.scores
  for each row execute function public.audit_row();
create trigger audit_attendance after insert or update or delete on public.attendance
  for each row execute function public.audit_row();
create trigger audit_assessments after insert or update or delete on public.assessments
  for each row execute function public.audit_row();
create trigger audit_students after insert or update or delete on public.students
  for each row execute function public.audit_row();
create trigger audit_assignments after insert or update or delete on public.teacher_assignments
  for each row execute function public.audit_row();
create trigger audit_configs after insert or update or delete on public.grading_configurations
  for each row execute function public.audit_row();
create trigger audit_tables after insert or update or delete on public.transmutation_tables
  for each row execute function public.audit_row();
create trigger audit_memberships after insert or update or delete on public.school_memberships
  for each row execute function public.audit_row();
-- finalize / approve / reopen only
create trigger audit_term_status after update on public.quarterly_grades
  for each row
  when (old.status is distinct from new.status
        and (new.status in ('finalized', 'approved') or old.status in ('finalized', 'approved')))
  execute function public.audit_row();

-- ---------------------------------------------------------------------
-- Default grading rules for a new school (all flagged UNVERIFIED)
-- ---------------------------------------------------------------------
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
end $$;

-- ---------------------------------------------------------------------
-- RPCs called by the app
-- ---------------------------------------------------------------------
create or replace function public.bootstrap_school(p_name text, p_year_label text default null, p_term_count integer default 3)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_school uuid; v_year uuid; v_start integer; v_label text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if exists (select 1 from public.school_memberships m where m.user_id = v_uid) then
    raise exception 'You already belong to a school';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'School name is required'; end if;
  if p_term_count not in (3, 4) then raise exception 'A school year has 3 terms or 4 quarters'; end if;

  insert into public.profiles (id, full_name, email)
  select u.id, coalesce(u.raw_user_meta_data ->> 'full_name', ''), u.email from auth.users u where u.id = v_uid
  on conflict (id) do nothing;

  insert into public.schools (name, created_by) values (trim(p_name), v_uid) returning id into v_school;
  insert into public.school_memberships (school_id, user_id, role) values (v_school, v_uid, 'admin');
  insert into public.school_settings (school_id) values (v_school);
  insert into public.grade_levels (school_id, level, name)
    select v_school, g, 'Grade ' || g from generate_series(7, 10) g;

  v_start := case when extract(month from current_date) >= 6
                  then extract(year from current_date)::integer
                  else extract(year from current_date)::integer - 1 end;
  v_label := coalesce(nullif(trim(p_year_label), ''), v_start || '-' || (v_start + 1));

  insert into public.academic_years (school_id, label, start_date, end_date, term_count, is_current)
  values (v_school, v_label, make_date(v_start, 6, 1), make_date(v_start + 1, 3, 31), p_term_count, true)
  returning id into v_year;

  insert into public.grading_periods (school_id, academic_year_id, term_no, name)
    select v_school, v_year, n,
           case when p_term_count = 3 then 'Term ' || n else 'Quarter ' || n end
    from generate_series(1, p_term_count) n;

  perform public.seed_default_grading(v_school);
  return v_school;
end $$;

create or replace function public.add_member_by_email(p_school uuid, p_email text, p_role public.app_role)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_id uuid; v_other uuid;
begin
  if not public.is_school_admin(p_school) then
    raise exception 'Only administrators can add members';
  end if;
  select u.id into v_user from auth.users u where lower(u.email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'No account uses that email. Ask the person to register first, then add them.';
  end if;
  select m.school_id into v_other from public.school_memberships m where m.user_id = v_user;
  if v_other is not null and v_other <> p_school then
    raise exception 'That account already belongs to another school';
  end if;
  insert into public.profiles (id, full_name, email)
    select u.id, coalesce(u.raw_user_meta_data ->> 'full_name', ''), u.email from auth.users u where u.id = v_user
  on conflict (id) do nothing;
  insert into public.school_memberships (school_id, user_id, role) values (p_school, v_user, p_role)
  on conflict (school_id, user_id) do update set role = excluded.role
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.finalize_term(p_assignment uuid, p_period uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_incomplete integer; v_n integer; r record;
begin
  if not public.can_write_assignment(p_assignment) then
    raise exception 'You are not allowed to finalize grades for this class';
  end if;
  perform public.recompute_assignment_period(p_assignment, p_period);

  select count(*) into v_incomplete
  from public.teacher_assignments ta
  join public.students st on st.section_id = ta.section_id and st.status = 'enrolled'
  left join public.quarterly_grades qg
         on qg.assignment_id = ta.id and qg.grading_period_id = p_period and qg.student_id = st.id
  where ta.id = p_assignment and (qg.id is null or not qg.is_complete);

  if v_incomplete > 0 then
    raise exception '% learner(s) still have incomplete grades. Enter or excuse every score and make sure a transmutation table is configured, then finalize again.', v_incomplete;
  end if;

  update public.quarterly_grades qg
     set status = 'finalized', finalized_by = auth.uid(), finalized_at = now()
    from public.students st
   where qg.assignment_id = p_assignment and qg.grading_period_id = p_period
     and st.id = qg.student_id and st.status = 'enrolled'
     and qg.status in ('provisional', 'incomplete');
  get diagnostics v_n = row_count;

  if v_n = 0 then raise exception 'There are no learners to finalize'; end if;

  for r in select qg.student_id from public.quarterly_grades qg
           where qg.assignment_id = p_assignment and qg.grading_period_id = p_period loop
    perform public.recompute_final_grade(p_assignment, r.student_id);
  end loop;
  return v_n;
end $$;

create or replace function public.reopen_term(p_assignment uuid, p_period uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_school uuid; v_n integer; r record;
begin
  select ta.school_id into v_school from public.teacher_assignments ta where ta.id = p_assignment;
  if not found then raise exception 'Class not found'; end if;
  if not (public.can_write_assignment(p_assignment)
          or public.has_school_role(v_school, array['admin', 'reviewer']::public.app_role[])) then
    raise exception 'You are not allowed to reopen grades for this class';
  end if;
  if exists (select 1 from public.quarterly_grades qg
             where qg.assignment_id = p_assignment and qg.grading_period_id = p_period and qg.status = 'approved')
     and not public.has_school_role(v_school, array['admin', 'reviewer']::public.app_role[]) then
    raise exception 'Approved grades can only be reopened by an administrator or the school head';
  end if;

  update public.quarterly_grades
     set status = 'provisional', finalized_by = null, finalized_at = null, approved_by = null, approved_at = null
   where assignment_id = p_assignment and grading_period_id = p_period and status in ('finalized', 'approved');
  get diagnostics v_n = row_count;

  perform public.recompute_assignment_period(p_assignment, p_period);
  for r in select qg.student_id from public.quarterly_grades qg
           where qg.assignment_id = p_assignment and qg.grading_period_id = p_period loop
    perform public.recompute_final_grade(p_assignment, r.student_id);
  end loop;
  return v_n;
end $$;

create or replace function public.approve_term(p_assignment uuid, p_period uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_school uuid; v_n integer; r record;
begin
  select ta.school_id into v_school from public.teacher_assignments ta where ta.id = p_assignment;
  if not found then raise exception 'Class not found'; end if;
  if not public.has_school_role(v_school, array['admin', 'reviewer']::public.app_role[]) then
    raise exception 'Only the school head or an administrator can approve grades';
  end if;
  if exists (select 1 from public.quarterly_grades qg
             join public.students st on st.id = qg.student_id and st.status = 'enrolled'
             where qg.assignment_id = p_assignment and qg.grading_period_id = p_period
               and qg.status not in ('finalized', 'approved')) then
    raise exception 'Only finalized grades can be approved';
  end if;

  update public.quarterly_grades
     set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where assignment_id = p_assignment and grading_period_id = p_period and status = 'finalized';
  get diagnostics v_n = row_count;

  for r in select qg.student_id from public.quarterly_grades qg
           where qg.assignment_id = p_assignment and qg.grading_period_id = p_period loop
    perform public.recompute_final_grade(p_assignment, r.student_id);
  end loop;
  return v_n;
end $$;

create or replace function public.recompute_school_grades(p_school uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare r record; v_n integer := 0;
begin
  if not public.is_school_admin(p_school) then
    raise exception 'Only administrators can recompute all grades';
  end if;
  for r in select distinct a.assignment_id, a.grading_period_id
           from public.assessments a where a.school_id = p_school loop
    perform public.recompute_assignment_period(r.assignment_id, r.grading_period_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Replace all rows of a transmutation table in ONE transaction, with validation.
-- p_rows: [{"min_initial":0,"max_initial":4.67,"transmuted":60}, ...]
create or replace function public.replace_transmutation_rows(p_table uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v_school uuid; v_n integer; r record;
begin
  select t.school_id into v_school from public.transmutation_tables t where t.id = p_table;
  if not found then raise exception 'Transmutation table not found'; end if;
  if not public.is_school_admin(v_school) then
    raise exception 'Only administrators can change transmutation rules';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Rows must be a list'; end if;

  select count(*) into v_n from jsonb_to_recordset(p_rows)
    as x(min_initial numeric, max_initial numeric, transmuted integer);
  if v_n < 2 then raise exception 'A transmutation table needs at least two rows'; end if;

  if (select min(x.min_initial) from jsonb_to_recordset(p_rows)
        as x(min_initial numeric, max_initial numeric, transmuted integer)) is distinct from 0 then
    raise exception 'The first row must start at an initial grade of 0';
  end if;

  if exists (
    select 1 from (
      select x.min_initial, x.max_initial, x.transmuted,
             lag(x.min_initial) over w as pmin, lag(x.transmuted) over w as pg
      from jsonb_to_recordset(p_rows) as x(min_initial numeric, max_initial numeric, transmuted integer)
      window w as (order by x.min_initial)
    ) y
    where y.pmin = y.min_initial or y.transmuted < y.pg or y.min_initial > y.max_initial
       or y.transmuted not between 0 and 100
  ) then
    raise exception 'Rows must have strictly increasing starting values, grades that never go down, and min <= max';
  end if;

  delete from public.transmutation_rows where table_id = p_table;
  insert into public.transmutation_rows (school_id, table_id, min_initial, max_initial, transmuted)
    select v_school, p_table, x.min_initial, x.max_initial, x.transmuted
    from jsonb_to_recordset(p_rows) as x(min_initial numeric, max_initial numeric, transmuted integer);

  update public.transmutation_tables set is_verified = false where id = p_table;
  update public.grading_configurations set is_verified = false where transmutation_table_id = p_table;
  for r in select gc.id from public.grading_configurations gc where gc.transmutation_table_id = p_table loop
    perform public.recompute_for_config(r.id);
  end loop;
  return v_n;
end $$;

-- Dashboard figures, calculated from real rows. SECURITY INVOKER: RLS limits what each role counts.
create or replace function public.dashboard_summary(p_school uuid, p_year uuid, p_period uuid, p_date date)
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'students', (select count(*) from public.students s
                 where s.school_id = p_school and s.academic_year_id = p_year and s.status = 'enrolled'),
    'sections', (select count(*) from public.sections sec
                 where sec.school_id = p_school and sec.academic_year_id = p_year),
    'subjects', (select count(distinct ta.subject_id) from public.teacher_assignments ta
                 where ta.school_id = p_school and ta.academic_year_id = p_year),
    'students_complete', (
      select count(*) from public.students s
      where s.school_id = p_school and s.academic_year_id = p_year and s.status = 'enrolled'
        and exists (select 1 from public.teacher_assignments ta where ta.section_id = s.section_id)
        and not exists (
          select 1 from public.teacher_assignments ta
          where ta.section_id = s.section_id
            and not exists (select 1 from public.quarterly_grades qg
                            where qg.assignment_id = ta.id and qg.student_id = s.id
                              and qg.grading_period_id = p_period and qg.is_complete))),
    'class_average', (select round(avg(qg.transmuted_grade)::numeric, 2)
                      from public.quarterly_grades qg
                      join public.teacher_assignments ta on ta.id = qg.assignment_id
                      where qg.school_id = p_school and qg.grading_period_id = p_period
                        and ta.academic_year_id = p_year and qg.transmuted_grade is not null),
    'histogram', (select coalesce(jsonb_object_agg(h.g::text, h.n), '{}'::jsonb)
                  from (select qg.transmuted_grade as g, count(*) as n
                        from public.quarterly_grades qg
                        where qg.school_id = p_school and qg.grading_period_id = p_period
                          and qg.transmuted_grade is not null
                        group by qg.transmuted_grade) h),
    'attendance', (select jsonb_build_object(
                     'present', count(*) filter (where a.status = 'present'),
                     'absent', count(*) filter (where a.status = 'absent'),
                     'late', count(*) filter (where a.status = 'late'),
                     'excused', count(*) filter (where a.status = 'excused'),
                     'total', count(*))
                   from public.attendance a
                   where a.school_id = p_school and a.attendance_date = p_date)
  );
$$;
