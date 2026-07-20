-- Rettelse: statusværnet på company_entra_config nulstillede også de skrivninger
-- der kommer fra serveren selv — spejlingen af client_secret_set fra
-- company_entra_secret og synkroniseringens egne statusfelter. Resultatet var at
-- en gemt client secret aldrig kunne komme til at vise "sat ✓", og at
-- last_sync_* aldrig blev opdateret.
--
-- Skellet er det samme som i anonymize_employee: en slutbruger har altid
-- auth.uid(); service-role (edge-funktioner, pg_cron) og direkte SQL har ikke.
-- Værnet skal kun beskytte mod at BROWSEREN forfalsker status.
create or replace function public.guard_entra_config_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_platform_admin() then
    return new; -- serveren selv, eller platform-admin (DCA-support)
  end if;
  new.dry_run_at := old.dry_run_at;
  new.first_sync_at := old.first_sync_at;
  new.last_sync_at := old.last_sync_at;
  new.last_sync_status := old.last_sync_status;
  new.last_sync_error := old.last_sync_error;
  new.client_secret_set := old.client_secret_set;
  -- Ny opsætning ⇒ tidligere godkendt tørkørsel gælder ikke længere.
  if new.tenant_id is distinct from old.tenant_id
     or new.client_id is distinct from old.client_id
     or new.group_id is distinct from old.group_id then
    new.dry_run_at := null;
  end if;
  return new;
end;
$$;
