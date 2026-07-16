-- Operia-konfiguration → Generelt: auto-refresh-interval. Hvor ofte klienterne
-- automatisk genhenter data fra databasen (fx nye pakker der dukker op). 0 =
-- slået fra. Ligger på singleton-rækken i platform_settings og er læsbar for
-- alle (using(true)) — kun platform-admins kan ændre den.
alter table public.platform_settings
  add column refresh_interval_seconds integer not null default 30
    check (refresh_interval_seconds >= 0 and refresh_interval_seconds <= 3600);

-- Audit (NIS2): log ændring af auto-refresh-intervallet som 'general.*'.
create or replace function public.audit_platform_general_settings()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.refresh_interval_seconds is distinct from old.refresh_interval_seconds then
    perform public.record_audit(null, 'general.refresh_interval_changed', 'platform_settings', 'platform', null,
      jsonb_build_object('from', old.refresh_interval_seconds, 'to', new.refresh_interval_seconds));
  end if;
  return new;
end;
$$;

create trigger audit_platform_general_settings_trg
  after update on public.platform_settings
  for each row execute function public.audit_platform_general_settings();

-- Udvid Logs-kategoriseringen med 'general' (→ config). Fuld forening som i
-- 20260716100000_audit_category_union.sql plus den nye linje. Klient-spejlet er
-- categoryOf i operia.logs.tsx — hold i sync.
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
    when 'general'        then 'config'
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
    when 'home'           then 'branding'
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
