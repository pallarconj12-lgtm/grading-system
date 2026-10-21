-- =====================================================================
-- Classroom Gradebook - 0001 schema
--
-- Design rules
--  * Every row belongs to a school (school_id). Cross-table references are
--    COMPOSITE foreign keys (id, school_id) so a row can never point at another
--    school's record, even if a client sends a foreign UUID.
--  * Grading rules (weights, transmutation, policy) are DATA, not code.
--  * Computed grades (quarterly_grades, final_grades) are written only by
--    SECURITY DEFINER triggers/functions (see 0002), never directly by clients.
--  * "quarterly_grades" stores one row per grading period. A period is a
--    "term" under DepEd Order 015 s.2026 (three terms) or a "quarter" in a
--    four-period school year. academic_years.term_count says which.
-- =====================================================================

create type public.app_role as enum ('admin', 'teacher', 'reviewer');
create type public.attendance_status as enum ('present', 'absent', 'late', 'excused');
create type public.assessment_category as enum ('WW', 'PT', 'QA');
create type public.enrollment_status as enum ('enrolled', 'transferred_out', 'dropped', 'archived');
create type public.grade_status as enum ('incomplete', 'provisional', 'finalized', 'approved');
-- exclude_flag: compute from recorded scores, flag the grade as incomplete/provisional
-- block:        no grade at all until every applicable score is entered or marked excused
create type public.missing_policy as enum ('exclude_flag', 'block');
create type public.transmutation_mode as enum ('table', 'zero_based');

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Identity and tenancy
-- ---------------------------------------------------------------------
create table public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  school_code text,
  division text,
  region text,
  address text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- v1 rule: a user belongs to exactly one school (unique user_id).
create table public.school_memberships (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (school_id, user_id)
);

create table public.school_settings (
  school_id uuid primary key references public.schools (id) on delete cascade,
  late_counts_as_present boolean not null default true,
  excused_counts_as_present boolean not null default false,
  default_paper text not null default 'A4' check (default_paper in ('A4', 'Letter', 'Legal')),
  -- Grade descriptors (editable, verify against the applicable DepEd Order)
  descriptors jsonb not null default
    '[{"min":90,"label":"Advancing"},{"min":80,"label":"Benchmarking"},{"min":75,"label":"Connecting"},{"min":65,"label":"Developing"},{"min":0,"label":"Emerging"}]'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Academic structure
-- ---------------------------------------------------------------------
create table public.academic_years (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  label text not null,
  start_date date,
  end_date date,
  term_count smallint not null default 3 check (term_count in (3, 4)),
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  unique (school_id, label),
  unique (id, school_id)
);
create unique index academic_years_one_current on public.academic_years (school_id) where is_current;

create table public.grading_periods (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  academic_year_id uuid not null,
  term_no smallint not null check (term_no between 1 and 4),
  name text not null,
  start_date date,
  end_date date,
  unique (academic_year_id, term_no),
  unique (id, school_id),
  foreign key (academic_year_id, school_id) references public.academic_years (id, school_id) on delete cascade
);

create table public.grade_levels (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  level smallint not null check (level between 7 and 10),
  name text not null,
  unique (school_id, level),
  unique (id, school_id)
);

create table public.sections (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  academic_year_id uuid not null,
  grade_level_id uuid not null,
  name text not null check (length(trim(name)) > 0),
  adviser_id uuid,
  created_at timestamptz not null default now(),
  unique (academic_year_id, grade_level_id, name),
  unique (id, school_id),
  foreign key (academic_year_id, school_id) references public.academic_years (id, school_id) on delete restrict,
  foreign key (grade_level_id, school_id) references public.grade_levels (id, school_id) on delete restrict,
  foreign key (school_id, adviser_id) references public.school_memberships (school_id, user_id) on delete set null (adviser_id)
);

-- ---------------------------------------------------------------------
-- Grading rules (data, verifiable)
-- ---------------------------------------------------------------------
create table public.transmutation_tables (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  name text not null,
  policy_source text not null default '',
  policy_version text not null default '',
  notes text not null default '',
  is_verified boolean not null default false,
  verified_by uuid,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, name),
  unique (id, school_id)
);

-- A row applies to initial grades from min_initial up to (but excluding) the next row's
-- min_initial. max_initial is stored for display and verification against the printed table.
create table public.transmutation_rows (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  table_id uuid not null,
  min_initial numeric(6, 2) not null check (min_initial between 0 and 100),
  max_initial numeric(6, 2) not null check (max_initial between 0 and 100),
  transmuted smallint not null check (transmuted between 0 and 100),
  unique (table_id, min_initial),
  check (min_initial <= max_initial),
  foreign key (table_id, school_id) references public.transmutation_tables (id, school_id) on delete cascade
);

create table public.grading_configurations (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  name text not null,
  policy_source text not null default '',
  policy_version text not null default '',
  ww_weight numeric(5, 2) not null check (ww_weight between 0 and 100),
  pt_weight numeric(5, 2) not null check (pt_weight between 0 and 100),
  qa_weight numeric(5, 2) not null check (qa_weight between 0 and 100),
  missing_policy public.missing_policy not null default 'exclude_flag',
  initial_decimals smallint not null default 2 check (initial_decimals between 0 and 4),
  transmutation_mode public.transmutation_mode not null default 'table',
  transmutation_table_id uuid,
  minimum_reportable_grade smallint not null default 60 check (minimum_reportable_grade between 0 and 100),
  passing_grade smallint not null default 75 check (passing_grade between 0 and 100),
  is_verified boolean not null default false,
  verified_by uuid,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ww_weight + pt_weight + qa_weight = 100),
  unique (school_id, name),
  unique (id, school_id),
  foreign key (transmutation_table_id, school_id) references public.transmutation_tables (id, school_id) on delete restrict
);

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  name text not null check (length(trim(name)) > 0),
  code text,
  learning_area text,
  grading_configuration_id uuid not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (school_id, name),
  unique (id, school_id),
  foreign key (school_id) references public.schools (id) on delete cascade,
  foreign key (grading_configuration_id, school_id) references public.grading_configurations (id, school_id) on delete restrict
);

create table public.teacher_assignments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  academic_year_id uuid not null,
  section_id uuid not null,
  subject_id uuid not null,
  teacher_id uuid not null,
  created_at timestamptz not null default now(),
  unique (academic_year_id, section_id, subject_id),
  unique (id, school_id),
  foreign key (academic_year_id, school_id) references public.academic_years (id, school_id) on delete restrict,
  foreign key (section_id, school_id) references public.sections (id, school_id) on delete cascade,
  foreign key (subject_id, school_id) references public.subjects (id, school_id) on delete restrict,
  -- removing a member who still has assignments is blocked on purpose: it would delete grade data
  foreign key (school_id, teacher_id) references public.school_memberships (school_id, user_id) on delete restrict
);

-- ---------------------------------------------------------------------
-- Learners
-- ---------------------------------------------------------------------
create table public.students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  academic_year_id uuid not null,
  lrn text not null check (lrn ~ '^[0-9]{12}$'),
  first_name text not null check (length(trim(first_name)) > 0),
  middle_name text,
  last_name text not null check (length(trim(last_name)) > 0),
  suffix text,
  sex text check (sex in ('Male', 'Female')),
  grade_level_id uuid not null,
  section_id uuid not null,
  status public.enrollment_status not null default 'enrolled',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, academic_year_id, lrn),
  unique (id, school_id),
  foreign key (academic_year_id, school_id) references public.academic_years (id, school_id) on delete restrict,
  foreign key (grade_level_id, school_id) references public.grade_levels (id, school_id) on delete restrict,
  foreign key (section_id, school_id) references public.sections (id, school_id) on delete restrict
);

-- ---------------------------------------------------------------------
-- Assessments and scores
-- ---------------------------------------------------------------------
create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  assignment_id uuid not null,
  grading_period_id uuid not null,
  category public.assessment_category not null,
  title text not null check (length(trim(title)) > 0),
  assessment_date date,
  max_score numeric(7, 2) not null check (max_score > 0),
  -- Optional share of the component (e.g. Summative Test 1 = 30 of the Examinations).
  -- If EVERY assessment in a category has a weight, the component percentage is the
  -- weighted average of the assessment ratios; otherwise it is total points / total possible.
  weight numeric(5, 2) check (weight > 0 and weight <= 100),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, school_id),
  foreign key (assignment_id, school_id) references public.teacher_assignments (id, school_id) on delete cascade,
  foreign key (grading_period_id, school_id) references public.grading_periods (id, school_id) on delete restrict
);

-- A missing score is the ABSENCE of a value (null / no row). It is never stored as zero.
-- Zero must be entered on purpose. is_excused removes the assessment for that learner.
create table public.scores (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  assessment_id uuid not null,
  student_id uuid not null,
  score numeric(7, 2) check (score >= 0),
  is_excused boolean not null default false,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assessment_id, student_id),
  foreign key (assessment_id, school_id) references public.assessments (id, school_id) on delete cascade,
  foreign key (student_id, school_id) references public.students (id, school_id) on delete cascade
);

create table public.quarterly_grades (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  assignment_id uuid not null,
  grading_period_id uuid not null,
  student_id uuid not null,
  ww_earned numeric(8, 2) not null default 0,
  ww_possible numeric(8, 2) not null default 0,
  ww_pct numeric(6, 2),
  pt_earned numeric(8, 2) not null default 0,
  pt_possible numeric(8, 2) not null default 0,
  pt_pct numeric(6, 2),
  qa_earned numeric(8, 2) not null default 0,
  qa_possible numeric(8, 2) not null default 0,
  qa_pct numeric(6, 2),
  initial_grade numeric(6, 2),
  transmuted_grade smallint,
  status public.grade_status not null default 'incomplete',
  is_complete boolean not null default false,
  missing_count integer not null default 0,
  finalized_by uuid,
  finalized_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  computed_at timestamptz not null default now(),
  unique (assignment_id, grading_period_id, student_id),
  foreign key (assignment_id, school_id) references public.teacher_assignments (id, school_id) on delete cascade,
  foreign key (grading_period_id, school_id) references public.grading_periods (id, school_id) on delete cascade,
  foreign key (student_id, school_id) references public.students (id, school_id) on delete cascade
);

create table public.final_grades (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  assignment_id uuid not null,
  student_id uuid not null,
  term1 smallint,
  term2 smallint,
  term3 smallint,
  term4 smallint,
  final_grade smallint,
  remarks text,
  status public.grade_status not null default 'incomplete',
  computed_at timestamptz not null default now(),
  unique (assignment_id, student_id),
  foreign key (assignment_id, school_id) references public.teacher_assignments (id, school_id) on delete cascade,
  foreign key (student_id, school_id) references public.students (id, school_id) on delete cascade
);

-- ---------------------------------------------------------------------
-- Attendance, report setup, audit
-- ---------------------------------------------------------------------
create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  section_id uuid not null,
  student_id uuid not null,
  attendance_date date not null,
  status public.attendance_status not null,
  remarks text,
  marked_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, attendance_date),
  foreign key (section_id, school_id) references public.sections (id, school_id) on delete cascade,
  foreign key (student_id, school_id) references public.students (id, school_id) on delete cascade
);

create table public.report_signatories (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  title text not null,
  full_name text not null default '',
  position text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  actor_id uuid,
  action text not null,
  table_name text not null,
  record_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Indexes (foreign keys and the access paths used by RLS and the UI)
-- ---------------------------------------------------------------------
create index on public.sections (school_id, academic_year_id);
create index on public.sections (adviser_id);
create index on public.students (school_id, academic_year_id);
create index on public.students (section_id);
create index on public.students (school_id, last_name, first_name);
create index on public.subjects (grading_configuration_id);
create index on public.teacher_assignments (teacher_id);
create index on public.teacher_assignments (section_id);
create index on public.teacher_assignments (subject_id);
create index on public.assessments (assignment_id, grading_period_id);
create index on public.scores (student_id);
create index on public.scores (assessment_id);
create index on public.quarterly_grades (assignment_id, grading_period_id);
create index on public.quarterly_grades (student_id);
create index on public.final_grades (student_id);
create index on public.attendance (section_id, attendance_date);
create index on public.transmutation_rows (table_id, min_initial);
create index on public.audit_logs (school_id, created_at desc);
create index on public.school_memberships (school_id);

-- ---------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------
create trigger set_updated_at before update on public.schools for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.school_settings for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.transmutation_tables for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.grading_configurations for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.students for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.assessments for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.scores for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.attendance for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.report_signatories for each row execute function public.set_updated_at();
