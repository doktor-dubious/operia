-- Operia-konfiguration → Home-design: platformens standardopsætning af
-- startsidens (Home) produktfliser i et Metro-agtigt rutenet. Gemmes som en
-- ordnet JSONB-liste på singleton-rækken platform_settings. Hvert element er
-- { "product": <produktnøgle>, "size": "1x1" | "2x2" }. Rækkefølgen bestemmer
-- pakningen i rutenettet (first-fit), så fliser aldrig overlapper. Home-siden
-- filtrerer listen efter virksomhedens aktive produkter ved visning.
alter table public.platform_settings
  add column home_tiles jsonb not null default '[]'::jsonb;

-- Audit (NIS2): log ændringer af Home-designet som en 'home.updated'-hændelse.
-- Platform-niveau (company_id = null). Detaljen bærer det nye layout, så loggen
-- er selvforklarende. Samme SECURITY DEFINER-mønster som de øvrige
-- platform_settings-triggere (jf. maps-udbyder-triggeren).
create or replace function public.audit_platform_home_settings()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.home_tiles is distinct from old.home_tiles then
    perform public.record_audit(null, 'home.updated', 'platform_settings', 'home', null,
      jsonb_build_object(
        'tiles', jsonb_array_length(new.home_tiles),
        'layout', new.home_tiles
      ));
  end if;
  return new;
end;
$$;

create trigger audit_platform_home_settings_trg
  after update on public.platform_settings
  for each row execute function public.audit_platform_home_settings();

-- Udvid Logs-kategoriseringen så 'home'-hændelser havner under 'branding'
-- (udseende/white-label), i tråd med 'appearance'/'product_text'. Ellers
-- identisk med den seneste definition (jf. maps_provider-migrationen).
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
    when 'home'           then 'branding'
    when 'maps'           then 'maps'
    when 'import'         then 'imports'
    when 'import_config'  then 'imports'
    else 'other'
  end
$$;
