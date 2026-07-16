-- Reparation af audit_category (Logs-kategorisering, NIS2):
--
--   1. home_tiles-migrationen (20260715090000) genudgav funktionen fra en
--      forældet skabelon (maps_provider-versionen) og tabte dermed mappings
--      for 'appearance', 'product_text', 'route', 'data_transfer' og
--      'log_drain' — alle disse hændelser er siden født med category='other'.
--   2. retention_policy-migrationen delte versionsnummer med home_tiles og
--      blev derfor aldrig anvendt (nu omdøbt til 20260715110000, så den kører
--      i denne push).
--
-- Her defineres den FULDE forening af alle hidtidige mappings (inkl. 'home' og
-- 'retention'), og de lagrede kategorier der nåede at blive født forkert
-- genberegnes. Klient-spejlet er categoryOf i operia.logs.tsx — hold i sync.
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

-- Genberegn de lagrede (stored generated) kategorier for rækker født under den
-- forældede definition. audit_log er append-only (block_mutation-triggeren),
-- men indholdet ændres ikke her — kun den genererede kolonne genberegnes — så
-- triggeren slås fra i netop denne transaktion.
alter table public.audit_log disable trigger audit_log_immutable;
update public.audit_log set action = action
  where category is distinct from public.audit_category(action);
alter table public.audit_log enable trigger audit_log_immutable;

-- email-inbound matcher på den lowercasede local part af modtageradressen —
-- håndhæv små bogstaver på email_name i databasen (UI'et normaliserer nu ved
-- gem), så et blandet-case navn aldrig igen kan lægge kanalen tavst ned.
update public.company_data_transfer_secret
  set email_name = lower(email_name)
  where email_name is distinct from lower(email_name);
alter table public.company_data_transfer_secret
  add constraint company_data_transfer_secret_email_name_lower
  check (email_name = lower(email_name));
