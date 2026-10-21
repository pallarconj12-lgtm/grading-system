-- Seed for `supabase db reset` (local development).
--
-- Fictional data is created per school by the function seed_demo_data(), because a school
-- only exists after a user signs up. Two ways to use it:
--
--   1. In the app:  Settings -> School -> "Load fictional demo data"  (administrators only)
--   2. In SQL:      select public.seed_demo_data('<your school uuid>');
--
-- Demo learners are marked: middle name 'DEMO', LRN starting 9000000, section "Demo ...".
-- Remove them with:  select public.remove_demo_data('<your school uuid>');
--
-- If a school already exists when this seed runs, load the demo data into the oldest one.
select public.seed_demo_data(s.id)
from public.schools s
order by s.created_at
limit 1;
