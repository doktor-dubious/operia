-- Batch-politikkerne (20260729100000) gav kun 'parcel_handler' og 'manager' —
-- men pakke-politikkerne (20260719090100, rollemodel v2) giver også
-- 'parcel_manager' og 'handheld_parcel_handler'. En bruger der må registrere
-- pakker skal også kunne oprette/afslutte batchen, ellers fejler batch-
-- modtagelse for netop de roller håndterminalen er tiltænkt.

drop policy parcel_batches_insert on public.parcel_batches;
create policy parcel_batches_insert on public.parcel_batches
  for insert to authenticated
  with check (
    (
      company_id = public.current_company_id()
      and public.has_any_role('manager', 'parcel_manager', 'parcel_handler', 'handheld_parcel_handler')
    )
    or public.is_platform_admin()
  );

drop policy parcel_batches_update on public.parcel_batches;
create policy parcel_batches_update on public.parcel_batches
  for update to authenticated
  using (
    (
      company_id = public.current_company_id()
      and public.has_any_role('manager', 'parcel_manager', 'parcel_handler', 'handheld_parcel_handler')
    )
    or public.is_platform_admin()
  )
  with check (
    company_id = public.current_company_id() or public.is_platform_admin()
  );
