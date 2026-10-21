-- =====================================================================
-- Classroom Gradebook - 0003 Row Level Security and privileges
--
-- Authorization is enforced HERE, in the database. The frontend only hides
-- controls for convenience. Matrix summary:
--
--   admin     school settings, users, grading rules, all learners/grades/attendance
--   teacher   only sections/classes they are assigned to (or advise)
--   reviewer  read-only on all grades and learners; may approve finalized grades
--
-- Tables with no INSERT/UPDATE/DELETE policy are write-protected for clients:
--   quarterly_grades, final_grades, audit_logs (written only by definer functions),
--   schools INSERT (use bootstrap_school), school_memberships INSERT (use add_member_by_email).
-- =====================================================================

alter table public.schools enable row level security;
alter table public.profiles enable row level security;
alter table public.school_memberships enable row level security;
alter table public.school_settings enable row level security;
alter table public.academic_years enable row level security;
alter table public.grading_periods enable row level security;
alter table public.grade_levels enable row level security;
alter table public.sections enable row level security;
alter table public.transmutation_tables enable row level security;
alter table public.transmutation_rows enable row level security;
alter table public.grading_configurations enable row level security;
alter table public.subjects enable row level security;
alter table public.teacher_assignments enable row level security;
alter table public.students enable row level security;
alter table public.assessments enable row level security;
alter table public.scores enable row level security;
alter table public.quarterly_grades enable row level security;
alter table public.final_grades enable row level security;
alter table public.attendance enable row level security;
alter table public.report_signatories enable row level security;
alter table public.audit_logs enable row level security;

-- schools -------------------------------------------------------------
create policy schools_select on public.schools for select to authenticated
  using (public.is_school_member(id));
create policy schools_update on public.schools for update to authenticated
  using (public.is_school_admin(id)) with check (public.is_school_admin(id));

-- profiles ------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_school_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- school_memberships --------------------------------------------------
create policy memberships_select on public.school_memberships for select to authenticated
  using (public.is_school_member(school_id));
create policy memberships_update on public.school_memberships for update to authenticated
  using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));
create policy memberships_delete on public.school_memberships for delete to authenticated
  using (public.is_school_admin(school_id));

-- School-level configuration: every member reads, only admins write ----
do $$
declare t text;
begin
  foreach t in array array[
    'school_settings', 'academic_years', 'grading_periods', 'grade_levels',
    'transmutation_tables', 'transmutation_rows', 'grading_configurations',
    'subjects', 'report_signatories'
  ] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_school_member(school_id))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_school_admin(school_id))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_school_admin(school_id))', t || '_delete', t);
  end loop;
end $$;

-- sections ------------------------------------------------------------
-- NOTE: the SELECT policy must use the row's own columns, not a lookup of the row by id.
-- INSERT ... RETURNING also evaluates SELECT policies, and a helper that re-queries
-- `sections` cannot see the row that is being inserted in the same statement.
create policy sections_select on public.sections for select to authenticated
  using (public.has_school_role(school_id, array['admin', 'reviewer']::public.app_role[])
         or adviser_id = auth.uid()
         or public.teaches_section(id));
create policy sections_insert on public.sections for insert to authenticated
  with check (public.is_school_admin(school_id));
create policy sections_update on public.sections for update to authenticated
  using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));
create policy sections_delete on public.sections for delete to authenticated
  using (public.is_school_admin(school_id));

-- teacher_assignments -------------------------------------------------
create policy assignments_select on public.teacher_assignments for select to authenticated
  using (public.has_school_role(school_id, array['admin', 'reviewer']::public.app_role[])
         or teacher_id = auth.uid()
         or public.advises_section(section_id));
create policy assignments_insert on public.teacher_assignments for insert to authenticated
  with check (public.is_school_admin(school_id));
create policy assignments_update on public.teacher_assignments for update to authenticated
  using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));
create policy assignments_delete on public.teacher_assignments for delete to authenticated
  using (public.is_school_admin(school_id));

-- students ------------------------------------------------------------
create policy students_select on public.students for select to authenticated
  using (public.can_read_section(section_id));
create policy students_insert on public.students for insert to authenticated
  with check (public.can_write_section(section_id));
create policy students_update on public.students for update to authenticated
  using (public.can_write_section(section_id)) with check (public.can_write_section(section_id));
create policy students_delete on public.students for delete to authenticated
  using (public.is_school_admin(school_id));

-- assessments ---------------------------------------------------------
create policy assessments_select on public.assessments for select to authenticated
  using (public.can_read_assignment(assignment_id));
create policy assessments_insert on public.assessments for insert to authenticated
  with check (public.can_write_assignment(assignment_id));
create policy assessments_update on public.assessments for update to authenticated
  using (public.can_write_assignment(assignment_id)) with check (public.can_write_assignment(assignment_id));
create policy assessments_delete on public.assessments for delete to authenticated
  using (public.can_write_assignment(assignment_id));

-- scores --------------------------------------------------------------
create policy scores_select on public.scores for select to authenticated
  using (public.can_read_assessment(assessment_id));
create policy scores_insert on public.scores for insert to authenticated
  with check (public.can_write_assessment(assessment_id));
create policy scores_update on public.scores for update to authenticated
  using (public.can_write_assessment(assessment_id)) with check (public.can_write_assessment(assessment_id));
create policy scores_delete on public.scores for delete to authenticated
  using (public.can_write_assessment(assessment_id));

-- computed grades: read only ------------------------------------------
create policy quarterly_grades_select on public.quarterly_grades for select to authenticated
  using (public.can_read_assignment(assignment_id));
create policy final_grades_select on public.final_grades for select to authenticated
  using (public.can_read_assignment(assignment_id));

-- attendance ----------------------------------------------------------
create policy attendance_select on public.attendance for select to authenticated
  using (public.can_read_section(section_id));
create policy attendance_insert on public.attendance for insert to authenticated
  with check (public.can_write_section(section_id));
create policy attendance_update on public.attendance for update to authenticated
  using (public.can_write_section(section_id)) with check (public.can_write_section(section_id));
create policy attendance_delete on public.attendance for delete to authenticated
  using (public.is_school_admin(school_id));

-- audit log: administrators and reviewers read; nobody writes directly -
create policy audit_select on public.audit_logs for select to authenticated
  using (public.has_school_role(school_id, array['admin', 'reviewer']::public.app_role[]));

-- ---------------------------------------------------------------------
-- Privileges. RLS decides WHICH rows; grants decide WHAT operations exist.
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;
revoke all on all functions in schema public from public;
revoke all on all functions in schema public from anon;
revoke all on all functions in schema public from authenticated;

grant usage on schema public to authenticated;

grant select, insert, update, delete on
  public.academic_years, public.grading_periods, public.grade_levels, public.sections,
  public.transmutation_tables, public.transmutation_rows, public.grading_configurations,
  public.subjects, public.teacher_assignments, public.students, public.assessments,
  public.scores, public.attendance, public.report_signatories
  to authenticated;

grant select, insert, update on public.school_settings to authenticated;
grant select, update on public.schools to authenticated;
grant select, update, delete on public.school_memberships to authenticated;
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;   -- email cannot be edited by the user
grant select on public.quarterly_grades, public.final_grades, public.audit_logs to authenticated;

-- functions used inside policies must be executable by the caller
grant execute on function
  public.is_school_member(uuid), public.has_school_role(uuid, public.app_role[]),
  public.is_school_admin(uuid), public.shares_school_with(uuid),
  public.can_read_section(uuid), public.can_write_section(uuid),
  public.teaches_section(uuid), public.advises_section(uuid),
  public.can_read_assignment(uuid), public.can_write_assignment(uuid),
  public.can_read_assessment(uuid), public.can_write_assessment(uuid),
  public.is_period_locked(uuid, uuid)
  to authenticated;

-- RPCs exposed to the app (each re-checks authorization inside)
grant execute on function
  public.bootstrap_school(text, text, integer),
  public.add_member_by_email(uuid, text, public.app_role),
  public.finalize_term(uuid, uuid), public.reopen_term(uuid, uuid), public.approve_term(uuid, uuid),
  public.recompute_school_grades(uuid),
  public.replace_transmutation_rows(uuid, jsonb),
  public.dashboard_summary(uuid, uuid, uuid, date)
  to authenticated;
