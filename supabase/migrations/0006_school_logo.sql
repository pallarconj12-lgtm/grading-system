-- =====================================================================
-- 0006  School logo
--   * schools.logo_path: storage path of the logo image
--   * public storage bucket "school-logos" (PNG/JPG/WebP, max 1 MB). The files are
--     only logos, so they are publicly readable; only a school's ADMINISTRATORS
--     can add, replace or remove files, and only inside their own school's folder.
-- =====================================================================
alter table public.schools add column if not exists logo_path text;

-- Skipped automatically where Supabase Storage is not installed (e.g. the local test database).
do $$
begin
  if to_regclass('storage.objects') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('school-logos', 'school-logos', true, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
    on conflict (id) do update
      set public = true, file_size_limit = 1048576,
          allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];

    drop policy if exists school_logos_insert on storage.objects;
    drop policy if exists school_logos_update on storage.objects;
    drop policy if exists school_logos_delete on storage.objects;

    -- the first folder of the file path is the school id, e.g. <school-id>/logo-123.png
    create policy school_logos_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'school-logos' and public.is_school_admin(((storage.foldername(name))[1])::uuid));
    create policy school_logos_update on storage.objects for update to authenticated
      using (bucket_id = 'school-logos' and public.is_school_admin(((storage.foldername(name))[1])::uuid))
      with check (bucket_id = 'school-logos' and public.is_school_admin(((storage.foldername(name))[1])::uuid));
    create policy school_logos_delete on storage.objects for delete to authenticated
      using (bucket_id = 'school-logos' and public.is_school_admin(((storage.foldername(name))[1])::uuid));
  end if;
end $$;
