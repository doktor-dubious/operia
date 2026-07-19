-- Rollemodel v2, opfølgning: parcel_documents_insert blev skrevet med de gamle
-- roller (parcel_handler/manager) og misser derfor præcis den nye
-- handheld_parcel_handler-rolle, som håndterminalens Tilstand-flise er gated på
-- (TILE_ROLES i HomeScreen.kt). Resultatet: en ren handheld-bruger kunne
-- uploade fotoet, men fik RLS-afvisning på selve dokumentposten (forældreløst
-- foto i storage). Bring politikken på linje med parcels_insert/-update
-- (20260719090100_role_permissions.sql) via has_any_role.
drop policy parcel_documents_insert on public.parcel_documents;
create policy parcel_documents_insert on public.parcel_documents
  for insert to authenticated
  with check (
    (
      company_id = public.current_company_id()
      and public.has_any_role('manager', 'parcel_manager', 'parcel_handler', 'handheld_parcel_handler')
    )
    or public.is_platform_admin()
  );
