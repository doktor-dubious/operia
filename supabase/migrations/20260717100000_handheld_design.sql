-- Operia-konfiguration → Handheld-design: platformens standardopsætning af
-- Android-håndterminalens startskærm — sidestykket til home_tiles/home_design,
-- men for handheld'en. To kolonner på singleton-rækken platform_settings:
--
--   handheld_tiles  — per-flise-overstyringer (titel, undertitel, ikon, farve,
--                     baggrundsfarve) for håndterminalens faste flisekatalog
--                     (modtag/udlevér/søg/rute/lager). Fliserne selv er
--                     kodedefinerede og feature-gatede i appen; her styres kun
--                     deres udseende.
--   handheld_design — indholdselementer (velkomsttitel, undertitel, logo, hero
--                     — hver med til/fra-flag) samt ikon-temaet.
alter table public.platform_settings
  add column handheld_tiles jsonb not null default '[]'::jsonb,
  add column handheld_design jsonb not null default jsonb_build_object(
    'iconTheme', 'happy',
    'welcomeTitle', '',
    'welcomeTitleEnabled', false,
    'subtitle', '',
    'subtitleEnabled', true,
    'logoUrl', '',
    'logoEnabled', false,
    'heroUrl', '',
    'heroEnabled', false
  );

-- Audit (NIS2): log ændringer af handheld-designet som 'handheld.updated'.
-- Separat trigger fra home.updated, så de to designs kan skelnes i Logs.
create or replace function public.audit_platform_handheld_settings()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.handheld_tiles is distinct from old.handheld_tiles
     or new.handheld_design is distinct from old.handheld_design then
    perform public.record_audit(null, 'handheld.updated', 'platform_settings', 'handheld', null,
      jsonb_build_object(
        'tiles', jsonb_array_length(new.handheld_tiles),
        'design', new.handheld_design
      ));
  end if;
  return new;
end;
$$;

drop trigger if exists audit_platform_handheld on public.platform_settings;
create trigger audit_platform_handheld
  after update on public.platform_settings
  for each row execute function public.audit_platform_handheld_settings();

-- Kategorisering (Logs): 'handheld' hører under branding ligesom 'home'.
-- Fuld forening af de hidtidige mappings — jf. 20260716100000, hvor en
-- delvis genudgivelse tabte mappings. Klient-spejlet er categoryOf i
-- operia.logs.tsx — hold i sync.
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
    when 'home'           then 'branding'
    when 'handheld'       then 'branding'
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
