-- Opret flere aktiver på én gang: samme navn, kategori og placering, men hvert
-- sit Aktiv-nr. Serienr. og stregkode er pr. enhed og kan derfor ikke deles i
-- en batch — stregkoden sættes bagefter, aktiv for aktiv, i listen over de
-- oprettede aktiver (samme mønster som tilstandsfotos pr. pakke i batch-
-- modtagelsen).
--
-- Hvorfor en RPC og ikke bare en fler-rækkes insert fra klienten: Aktiv-nr.
-- skal komme fra serveren, og assets_guard udfylder det kun, når kolonnen ikke
-- medsendes — hvilket klientens genererede Insert-type ikke tillader nu, hvor
-- asset_tag er NOT NULL. Én sætning her giver desuden atomaritet (enten
-- oprettes alle, eller ingen) og et sted at sætte et loft over antallet.

-- Loftet er en spærre mod slåfejl («1000» i stedet for «10»), ikke en
-- kapacitetsgrænse: hver række udløser nummergivning og en hændelseslinje.
create or replace function public.create_assets_batch(
  p_company_id uuid,
  p_count int,
  p_name text,
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
begin
  -- Klienten er utroværdig: samme rettighedskrav som assets_write-politikken.
  if p_company_id is null or not public.can_write_assets(p_company_id) then
    raise exception 'no_access';
  end if;
  if v_name = '' then
    raise exception 'name_required';
  end if;
  if p_count is null or p_count < 1 or p_count > 200 then
    raise exception 'count_out_of_range';
  end if;

  -- assets_guard tildeler hvert Aktiv-nr. (kolonnen udelades bevidst) og
  -- validerer samtidig, at kategori/placering tilhører virksomheden.
  return query
  with created as (
    insert into public.assets (company_id, name, category_id, location_id)
    select p_company_id, v_name, p_category_id, p_location_id
    from generate_series(1, p_count)
    returning assets.id, assets.asset_tag
  )
  select created.id, created.asset_tag from created order by created.asset_tag;
end;
$$;

revoke all on function public.create_assets_batch(uuid, int, text, uuid, uuid) from public;
grant execute on function public.create_assets_batch(uuid, int, text, uuid, uuid) to authenticated;
