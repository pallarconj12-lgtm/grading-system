# Classroom Gradebook

A grading, attendance and report-card web app for Philippine Junior High School (Grades 7-10) teachers.
React + Vite, Supabase (PostgreSQL, Auth, Row Level Security), deployable on Vercel.

> **Read this first: grading rules are NOT verified.**
> The default weights, the transmutation table, the grade descriptors and the 3-term year were prepared from
> third-party summaries of DepEd Order No. 015, s. 2026. They were **not** checked against the official issuance.
> Every rule is stored flagged *not verified*, a banner is shown in the app, and report cards are watermarked until an
> administrator compares each value with the official text and marks it verified (Settings, Grading rules and
> Transmutation). Do not describe this app as DepEd-compliant until you have done that.

## What it does

- **Dashboard** computed from your database (no hardcoded figures).
- **Students**: add, edit, archive/restore, search and filter, duplicate-LRN prevention, CSV import (all-or-nothing, with line-numbered errors) and export.
- **Subjects, sections, grade levels, teacher assignments, school years and 3 or 4 grading periods.**
- **Grading**: Written Works / Performance Tasks / Quarterly Assessment with configurable weights that must total 100;
  a configurable lookup-table transmutation (never a made-up formula); optional zero-based mode.
  Missing scores are **never** counted as zero: they are excluded and the grade is flagged incomplete.
  `0` is a real zero, `X` is excused. Grades are provisional until a term is finalized; finalized terms are locked until reopened; reviewers approve.
- **Gradebook**: spreadsheet-style table, keyboard entry (Enter / arrows), validation, auto-save, CSV import/export, printing.
- **Attendance**: present / absent / late / excused, one record per learner per day, monthly report, CSV export, print.
- **Reports**: individual or whole-section report cards, class grade summary, audit log. Printing uses the browser (save as PDF there).
- **Roles**: administrator, teacher, reviewer / school head, enforced by Row Level Security in the database, not just hidden buttons.
- **Audit log** of changes to scores, attendance, learners, rules and approvals.
- **Privacy**: collects only what grading needs (name, LRN, sex, section). No birth dates, addresses or contact details.

## Project layout

```
supabase/migrations/   0001 schema, 0002 functions + grade engine, 0003 RLS, 0004 demo data
supabase/seed.sql      optional fictional demo data (local dev)
supabase/tests/        database tests (real migrations run in an in-process Postgres)
src/lib/grading/       transmutation, grade computation, validation (pure, unit-tested)
src/pages, components, context, lib
```

Grades are computed **in the database** (triggers) and mirrored by the same logic in `src/lib/grading` for instant
on-screen feedback. A test checks that both produce identical results for every demo grade.

## 1. Install

```bash
npm install
cp .env.example .env     # then fill it in (step 2)
```

Requires Node 18+.

## 2. Configure Supabase

1. Create a project at <https://supabase.com>.
2. **Run the migrations in order** in the SQL editor (or `supabase db push` with the CLI):
   `0001_schema.sql`, `0002_functions.sql`, `0003_rls.sql`, `0004_demo_data.sql`.
3. **Settings, API**: copy the *Project URL* and the **anon / publishable** key into `.env`:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
   **Never** put the `service_role` key in this app or in any `VITE_` variable. Anything starting with `VITE_` is public.
4. **Authentication, URL configuration**: set *Site URL* to your app URL (`http://localhost:5173` for local work,
   your Vercel URL in production) and add it to *Redirect URLs* so password-reset links work.
5. For a quick start you may turn off *Confirm email* under Authentication, Providers, Email. Keep it on in production.

## 3. Run locally

```bash
npm run dev       # http://localhost:5173
npm test          # unit + database tests
npm run build     # production build in dist/
```

Without the `.env` values the app shows a setup screen and a clearly labeled **demo preview** at `/demo`
(fictional numbers, nothing saved).

## 4. First use and feature walkthrough

1. Open the app, **create an account**, then complete onboarding (school name, school year, 3 terms or 4 quarters). You become the administrator.
2. **Settings, Demo data, Load demo data** to get fictional learners, two sections and graded classes. (Remove them later in the same place.)
3. **Settings, Users and roles**: have a colleague register, then add them by e-mail as Teacher or School head.
   **Subjects, Teacher assignments** decides which classes each teacher can open.
4. **Gradebook**: pick a class and term. Type a score and press Enter. Clear a cell to mark it *not yet recorded*
   (the learner shows "n missing" and the grade is incomplete, not zero). Add assessments with the WW / PT / QA buttons.
   Try the QA presets (30 / 30 / 40) to see weighted exams.
5. **Finalize term** once every learner is complete. Scores lock. A reviewer can **Approve**; anyone allowed can **Reopen**.
6. **Attendance**: mark a day, save, then open the monthly report.
7. **Reports**: print a report card, a whole section, or the class summary. Grades that are not finalized stay blank
   (or appear watermarked "PROVISIONAL" if you include them).
8. **Settings, Grading rules / Transmutation**: compare against the official DepEd Order, correct anything that differs,
   then tick the verification box. Editing a verified rule clears its verification and recomputes affected grades.
9. **Reports, Audit log** shows who changed what.

To see the security model work, sign in as a teacher and confirm you cannot open another teacher's class, then sign in as a
reviewer and confirm scores are read-only.

## 5. Deploy

**Supabase**: already hosted. Apply the same four migrations to your production project. Do not run the demo seed in production.

**Vercel**
1. Push the repo to GitHub and import it at <https://vercel.com/new> (framework: Vite; build `npm run build`; output `dist`).
2. Add environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. Deploy, then add the Vercel URL to Supabase *Site URL* and *Redirect URLs*.
`vercel.json` already contains the single-page-app rewrite and security headers.

Before real use: enable e-mail confirmation, enable Supabase backups, review the data-privacy notes below, and verify the grading rules.

## Data privacy (Republic Act 10173)

Learner records are personal information about minors. This app minimizes what it stores, isolates each school's data
with Row Level Security, and logs changes. It does not by itself make your school compliant: you still need a privacy
notice and consent process, a designated Data Protection Officer, access policies, and a retention and breach plan.
Never use real learner data for demos or training.

## Known limits

- Report-card and sheet layouts are generic, not the official DepEd forms (SF9 / SF10). Compare before using them for official submission.
- One account belongs to one school.
- PDF output uses the browser's "Save as PDF" from the print dialog.
- Learner-by-learner transfer and promotion between school years are not automated: create sections and add learners for the new year.
- Tested by automated tests (grading, permissions, database security and workflow). Browser flows were smoke-tested only
  without a live Supabase project, so run through the walkthrough above on your own project before trusting it.
