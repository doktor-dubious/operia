-- Nyt aktiv på håndterminalen (flisen asset_new, feature hh_asset_new).
--
-- Registeret har hidtil været manager-territorium: assets_write og
-- can_write_assets kræver manager/asset_manager, og oprettelsen sker på
-- skrivebordets /assets/new. Men håndterminalens brugere er dem, der står med
-- kassen i hånden, når aktivet pakkes ud — skal de først hente en manager til
-- en pc, bliver aktivet i praksis oprettet dagen efter (eller aldrig).
--
-- Derfor ÉN SECURITY DEFINER-RPC, der kun kan oprette — ikke redigere, udfase
-- eller omnummerere — med flow-rollernes grænse (can_operate_assets: manager,
-- asset_manager, asset_handler, handheld_asset_handler), præcis som tjek
-- ud/ind, flyt og dokumentér. Registerets øvrige skrivninger er uændret
-- manager-territorium.
--
-- Aktiv-nr. tildeles af assets_guard (klienten vælger det aldrig, og
-- next_asset_no's manager-krav er derfor uberørt) og returneres, så terminalen
-- kan vise nummeret umiddelbart efter oprettelsen. 'created'-hændelsen skriver
-- den generiske assets-trigger (log_asset_event) som ved enhver anden
-- oprettelse.

create or replace function public.create_asset_handheld(
  p_company_id uuid,
  p_name text,
  p_serial_no text default null,
  p_barcode text default null,
  p_category_id uuid default null,
  p_location_id uuid default null
)
returns table (id uuid, asset_tag text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_serial text := nullif(btrim(coalesce(p_serial_no, '')), '');
  v_barcode text := nullif(btrim(coalesce(p_barcode, '')), '');
begin
  -- Klienten er utroværdig: rettigheden gentjekkes her, ikke i appen.
  if p_company_id is null or not public.can_operate_assets(p_company_id) then
    raise exception 'no_access' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'name_required' using errcode = 'P0001';
  end if;

  -- Stregkoden skal pege på præcis ét AKTIVT aktiv
  -- (assets_company_barcode_active_uniq). Konflikten fanges her, så
  -- terminalen får en ren fejlkode i stedet for en rå 23505 — samme skelnen
  -- som webbens stregkode-konflikt.
  if v_barcode is not null and exists (
    select 1 from public.assets a
    where a.company_id = p_company_id
      and a.barcode = v_barcode
      and a.status <> 'retired'
  ) then
    raise exception 'barcode_taken' using errcode = 'P0001';
  end if;

  -- assets_guard tildeler Aktiv-nr. (kolonnen udelades bevidst) og validerer,
  -- at kategori/placering tilhører virksomheden.
  return query
  with created as (
    insert into public.assets
      (company_id, name, serial_no, barcode, category_id, location_id)
    values
      (p_company_id, v_name, v_serial, v_barcode, p_category_id, p_location_id)
    returning assets.id, assets.asset_tag
  )
  select created.id, created.asset_tag from created;
end;
$$;

revoke all on function public.create_asset_handheld(uuid, text, text, text, uuid, uuid)
  from public, anon;
grant execute on function public.create_asset_handheld(uuid, text, text, text, uuid, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Featurenøglen til flisen (produkt: assets) — som de øvrige hh_asset_*.
-- Kunder med aktiv-produktet får den tildelt, så flisen dukker op (has() viser
-- kun eksplicit tildelte features, når mindst én hh_-feature er konfigureret).
-- ---------------------------------------------------------------------------
insert into public.feature_catalog (key, product_key, name, description, name_en, description_en) values
  ('hh_asset_new', 'assets', 'Håndterminal: Nyt aktiv',
   'Opret et nyt aktiv på håndterminalen — nummeret tildeles af serveren',
   'Handheld: New asset', 'Create a new asset on the handheld — the server assigns the number')
on conflict (key) do nothing;

insert into public.company_features (company_id, feature_key)
select cp.company_id, 'hh_asset_new'
from public.company_products cp
where cp.product_key = 'assets'
on conflict (company_id, feature_key) do nothing;
