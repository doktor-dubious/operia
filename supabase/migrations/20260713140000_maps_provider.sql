-- Operia-konfiguration → Kort & ruter: hvilken kort-/ruteudbyder platformen
-- bruger til ruteplanlægning. Default OpenRouteService (gratis, OSM-baseret) —
-- se projekt-hukommelsens route-planner-maps for begrundelsen.
alter table public.platform_settings
  add column maps_provider text not null default 'openrouteservice'
    check (maps_provider in ('google', 'openrouteservice'));

-- Audit (NIS2): log skift af kort-/ruteudbyder som en 'maps.changed'-hændelse.
create or replace function public.audit_platform_maps_settings()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.maps_provider is distinct from old.maps_provider then
    perform public.record_audit(null, 'maps.changed', 'platform_settings', 'platform', null,
      jsonb_build_object('from', old.maps_provider, 'to', new.maps_provider));
  end if;
  return new;
end;
$$;

create trigger audit_platform_maps_settings_trg
  after update on public.platform_settings
  for each row execute function public.audit_platform_maps_settings();

-- Udvid Logs-kategoriseringen med 'maps' (Kort & ruter), så maps.changed ikke
-- falder i 'other'. Ellers identisk med definitionen i
-- 20260713120000_audit_log_category_level.sql.
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
    when 'maps'           then 'maps'
    when 'import'         then 'imports'
    when 'import_config'  then 'imports'
    else 'other'
  end
$$;
