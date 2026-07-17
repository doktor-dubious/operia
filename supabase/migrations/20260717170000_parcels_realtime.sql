-- Realtime på parcels: webkonsollen skal afspejle håndterminalens handlinger
-- (udlevering, afvisning, retur, flytning) med det samme i stedet for at vente
-- på app-skallens auto-refresh (platform_settings.refresh_interval_seconds,
-- pt. 30s). Pollingen bliver stående som fallback, hvis websocket'en falder ud.
--
-- Sikkerhed: Realtime håndhæver RLS på abonnenten — parcels_select er
-- company-scoped ((company_id = current_company_id()) OR is_platform_admin()),
-- så en kunde kun får ændringer på egne pakker. Publikationen i sig selv
-- åbner altså ikke for data på tværs af tenants.
--
-- Replica identity forbliver default (primærnøgle): vi bruger kun hændelsen som
-- signal om "noget ændrede sig" og læser ikke old_record, så 'full' ville blot
-- give unødig WAL-vækst.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'parcels'
  ) then
    alter publication supabase_realtime add table public.parcels;
  end if;
end
$$;
