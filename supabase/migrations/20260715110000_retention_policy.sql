-- Opbevaringspolitik (GDPR art. 5(1)(e) — opbevaringsbegrænsning): platform-
-- indstillede vinduer for hvor længe logdata beholdes. NULL (standard) = behold
-- for altid, dvs. adfærden er uændret indtil DCA aktivt sætter et vindue.
--
--   audit_retention_days  : audit_log (indeholder persondata i summary/detail)
--   import_retention_days : import_runs + inbound_files (spor af HR-CSV-filer)
--
-- parcel_events purges BEVIDST IKKE: det er kædedokumentationen (chain of
-- custody) og følger pakkens livscyklus — ikke en logserie med eget vindue.
-- Selve sletningen kører dagligt via pg_cron (run_retention_purge) og logges
-- som retention.purged, så nedskæringen selv er sporbar (NIS2).

alter table public.platform_settings
  add column audit_retention_days  integer check (audit_retention_days  > 0),
  add column import_retention_days integer check (import_retention_days > 0);

-- ---------------------------------------------------------------------------
-- Ændringer af politikken skal spores (NIS2).
-- ---------------------------------------------------------------------------
create or replace function public.audit_platform_retention()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.audit_retention_days is distinct from old.audit_retention_days
     or new.import_retention_days is distinct from old.import_retention_days then
    perform public.record_audit(null, 'retention.changed', 'platform_settings', 'platform', null,
      jsonb_build_object('audit_retention_days', new.audit_retention_days,
                         'import_retention_days', new.import_retention_days));
  end if;
  return new;
end;
$$;

create trigger platform_settings_retention_audit
  after update on public.platform_settings
  for each row execute function public.audit_platform_retention();

-- retention.* hører hjemme i kategorien 'log' (som log_drain.*). Spejles af
-- klientens categoryOf i operia.logs.tsx.
create or replace function public.audit_category(p_action text)
returns text language sql immutable as $$
  select case split_part(coalesce(p_action, ''), '.', 1)
    when 'parcel'         then 'parcels'
    when 'parcel_flow'    then 'parcels'
    when 'employee'       then 'directory'
    when 'department'     then 'directory'
    when 'location'       then 'config'
    when 'handling_class' then 'config'
    when 'carrier'        then 'config'
    when 'shipping'       then 'shipping'
    when 'agreement'      then 'shipping'
    when 'asset'          then 'assets'
    when 'asset_category' then 'assets'
    when 'asset_location' then 'assets'
    when 'assets'         then 'assets'
    when 'inventory_item' then 'inventory'
    when 'locker'         then 'lockers'
    when 'user'           then 'access'
    when 'product'        then 'entitlements'
    when 'feature'        then 'entitlements'
    when 'template'       then 'branding'
    when 'language'       then 'branding'
    when 'currency'       then 'branding'
    when 'appearance'     then 'branding'
    when 'product_text'   then 'branding'
    when 'maps'           then 'maps'
    when 'route'          then 'maps'
    when 'import'         then 'imports'
    when 'import_config'  then 'imports'
    when 'data_transfer'  then 'imports'
    when 'log_drain'      then 'log'
    when 'retention'      then 'log'
    else 'other'
  end
$$;

-- ---------------------------------------------------------------------------
-- Uforanderlighedstriggeren skal lukke purge-funktionen (og KUN den) igennem.
-- GUC'en kan sættes af enhver session, men klientroller har fortsat hverken
-- DELETE-privilegiet (revoked) eller adgang til run_retention_purge — beskyt-
-- telsen mod klienter ligger i privilegierne, GUC'en beskytter mod utilsigtede
-- service-role-sletninger.
-- ---------------------------------------------------------------------------
create or replace function public.block_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and current_setting('operia.retention_purge', true) = 'on' then
    return old;
  end if;
  raise exception '% er append-only (% ikke tilladt)', tg_table_name, tg_op;
end;
$$;

-- ---------------------------------------------------------------------------
-- Selve oprydningen. No-op når intet vindue er sat.
-- ---------------------------------------------------------------------------
create or replace function public.run_retention_purge()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_audit_days  integer;
  v_import_days integer;
  n bigint;
begin
  select audit_retention_days, import_retention_days
    into v_audit_days, v_import_days
    from platform_settings where id;

  -- Transaktionslokal (is_local => true): åbner block_mutation for denne purge.
  perform set_config('operia.retention_purge', 'on', true);

  if v_audit_days is not null then
    delete from audit_log
      where created_at < now() - make_interval(days => v_audit_days);
    get diagnostics n = row_count;
    if n > 0 then
      perform record_audit(null, 'retention.purged', 'audit_log', 'platform', n::text,
        jsonb_build_object('table', 'audit_log', 'deleted', n, 'retention_days', v_audit_days));
    end if;
  end if;

  if v_import_days is not null then
    delete from import_runs
      where created_at < now() - make_interval(days => v_import_days);
    get diagnostics n = row_count;
    if n > 0 then
      perform record_audit(null, 'retention.purged', 'import_run', 'platform', n::text,
        jsonb_build_object('table', 'import_runs', 'deleted', n, 'retention_days', v_import_days));
    end if;

    delete from inbound_files
      where received_at < now() - make_interval(days => v_import_days);
    get diagnostics n = row_count;
    if n > 0 then
      perform record_audit(null, 'retention.purged', 'inbound_file', 'platform', n::text,
        jsonb_build_object('table', 'inbound_files', 'deleted', n, 'retention_days', v_import_days));
    end if;
  end if;
end;
$$;

revoke execute on function public.run_retention_purge() from public, anon, authenticated;

-- Dagligt kl. 03:40 UTC. Selv-tavst: funktionen no-op'er når begge vinduer er
-- NULL, så jobbet koster intet før politikken aktiveres.
create extension if not exists pg_cron;
select cron.schedule('operia-retention-purge', '40 3 * * *', $$select public.run_retention_purge()$$);
