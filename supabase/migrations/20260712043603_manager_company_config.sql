-- Konfigurér-siderne (virksomhedens egen konfiguration): managers kan
-- redigere deres egen virksomheds række (lokalisering, logo, indkøbs-email)
-- og skrive/rydde op i egen mappe i company-logos-bucket'en. Additivt oven
-- på platform-admin-adgangen.

create policy companies_manager_update on public.companies
  for update to authenticated
  using (id = public.current_company_id() and public.has_role('manager'))
  with check (id = public.current_company_id() and public.has_role('manager'));

-- company-logos: managers får skrive-/listeadgang til egen virksomheds mappe
-- ((storage.foldername(name))[1] er company-id'et, som i parcel-photos).
drop policy company_logos_insert on storage.objects;
drop policy company_logos_update on storage.objects;
drop policy company_logos_delete on storage.objects;
drop policy company_logos_select on storage.objects;

create policy company_logos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'company-logos'
    and (
      public.is_platform_admin()
      or (
        public.has_role('manager')
        and (storage.foldername(name))[1] = public.current_company_id()::text
      )
    )
  );

create policy company_logos_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'company-logos'
    and (
      public.is_platform_admin()
      or (
        public.has_role('manager')
        and (storage.foldername(name))[1] = public.current_company_id()::text
      )
    )
  )
  with check (
    bucket_id = 'company-logos'
    and (
      public.is_platform_admin()
      or (
        public.has_role('manager')
        and (storage.foldername(name))[1] = public.current_company_id()::text
      )
    )
  );

create policy company_logos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'company-logos'
    and (
      public.is_platform_admin()
      or (
        public.has_role('manager')
        and (storage.foldername(name))[1] = public.current_company_id()::text
      )
    )
  );

create policy company_logos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'company-logos'
    and (
      public.is_platform_admin()
      or (
        public.has_role('manager')
        and (storage.foldername(name))[1] = public.current_company_id()::text
      )
    )
  );
