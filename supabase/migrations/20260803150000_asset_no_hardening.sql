-- Hærdning af aktiv-nummerserien (opfølgning på 20260803120644/124314):
--
-- 1) lpad() TRUNKERER når input er længere end mållængden, så en tæller der
--    vokser ud over den faste længde gav et forkert (afkortet) nummer — og i
--    værste fald en evig løkke i next_asset_no_unchecked, fordi alle afkortede
--    kandidater allerede fandtes. Nu polstres der kun; vokser tælleren ud over
--    længden, får nummeret blot et ciffer mere (som en kilometertæller).
--
-- 2) Aktiv-nr. var kun "fast" i klienten (deaktiveret felt) — en direkte
--    PostgREST-PATCH kunne omdøbe det frit. Klienten er utroværdig, så
--    assets_guard afviser nu enhver ændring af asset_tag ved UPDATE.
--    Undtagelsen er en tømning (null/blank): så tildeler serveren et NYT nummer
--    fra virksomhedens serie. Det er reparationsvejen for de rå UUID'er, som
--    120644-backfillet stemplede på gamle aktiver — et nummer kan altså
--    udskiftes, men aldrig vælges af klienten.
--
-- 3) next_asset_no krævede kun medlemskab af virksomheden — enhver bruger
--    kunne brænde numre af serien og tælle bestanden. Nu samme rettighedskrav
--    som create_assets_batch (can_write_assets).
--
-- 4) create_assets_batch sorterede tekstligt, så en upolstret serie hen over
--    et cifferskifte kom retur som 10,11,12,8,9 — og scannerens "første række
--    uden stregkode" fulgte den forkerte rækkefølge. Længde-først-sortering
--    giver numerisk orden for ens præfiks.

create or replace function public.next_asset_no_unchecked(p_company_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text;
  v_prefix text;
  v_len int;
  v bigint;
  candidate text;
begin
  select c.asset_no_type, c.asset_no_prefix, c.asset_no_length
    into v_type, v_prefix, v_len
  from public.companies c
  where c.id = p_company_id;

  if v_type is null then
    raise exception 'Ukendt virksomhed';
  end if;

  if v_type = 'uuid' then
    return gen_random_uuid()::text;
  end if;

  -- Første fortløbende nummer for virksomheden: start tælleren over det
  -- højeste eksisterende nummer med samme præfiks, så et skift fra UUID (eller
  -- et importeret nummersæt) ikke begynder forfra på DCA-0001. Sker kun én
  -- gang; skifter præfikset senere, fortsætter tælleren blot — dubletter
  -- forhindres uanset af løkken nedenfor.
  insert into public.asset_no_seq (company_id, last_value)
  select p_company_id, coalesce(max(s.n), 0)
  from (
    select (substring(a.asset_tag from char_length(v_prefix) + 1))::bigint as n
    from public.assets a
    where a.company_id = p_company_id
      and left(a.asset_tag, char_length(v_prefix)) = v_prefix
      -- Øvre grænse på 18 cifre: holder ::bigint inden for rækkevidde.
      and substring(a.asset_tag from char_length(v_prefix) + 1) ~ '^[0-9]{1,18}$'
  ) s
  on conflict (company_id) do nothing;

  loop
    insert into public.asset_no_seq as s (company_id, last_value)
    values (p_company_id, 1)
    on conflict (company_id) do update set last_value = s.last_value + 1
    returning s.last_value into v;

    -- Kun polstring, aldrig afkortning: lpad('10', 1, '0') ville give '1'.
    candidate := v_prefix
      || case
           when v_len is null or char_length(v::text) >= v_len then v::text
           else lpad(v::text, v_len, '0')
         end;

    -- Tælleren kan være bagud, hvis nummeret én gang er importeret manuelt —
    -- så springes det over i stedet for at give en unik-fejl i brugerens ansigt.
    exit when not exists (
      select 1 from public.assets
      where company_id = p_company_id and asset_tag = candidate
    );
  end loop;

  return candidate;
end;
$$;

-- Klientens indgang: nu med samme rettighedskrav som create_assets_batch —
-- hvert kald brænder et nummer af serien, så det er forbeholdt dem der kan
-- oprette aktiver.
create or replace function public.next_asset_no(p_company_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_company_id is null or not public.can_write_assets(p_company_id) then
    raise exception 'no_access';
  end if;
  return public.next_asset_no_unchecked(p_company_id);
end;
$$;

-- Guarden håndhæver nu nummerets uforanderlighed server-side. Tenant-
-- valideringen af FK'erne er uændret.
create or replace function public.assets_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.asset_tag is not null then
    new.asset_tag := btrim(new.asset_tag);
    if new.asset_tag = '' then
      new.asset_tag := null;
    end if;
  end if;
  if new.asset_tag is null then
    -- INSERT uden nummer (ældre klient, API) — eller en UPDATE der tømmer
    -- feltet (renumber_asset): serveren tildeler et nyt fra serien.
    new.asset_tag := public.next_asset_no_unchecked(new.company_id);
  elsif tg_op = 'UPDATE' and new.asset_tag is distinct from old.asset_tag then
    -- Nummeret er aktivets identitet ud mod labels, lister og historik — det
    -- kan udskiftes (via tømning ovenfor), men aldrig omdøbes af klienten.
    raise exception 'asset_tag_immutable';
  end if;

  if new.category_id is not null and not exists (
    select 1 from public.asset_categories c
    where c.id = new.category_id and c.company_id = new.company_id
  ) then
    raise exception 'Kategorien tilhører ikke virksomheden';
  end if;
  if new.location_id is not null and not exists (
    select 1 from public.asset_locations l
    where l.id = new.location_id and l.company_id = new.company_id
  ) then
    raise exception 'Placeringen tilhører ikke virksomheden';
  end if;
  if new.assigned_to_employee_id is not null and not exists (
    select 1 from public.employees e
    where e.id = new.assigned_to_employee_id and e.company_id = new.company_id
  ) then
    raise exception 'Medarbejderen tilhører ikke virksomheden';
  end if;
  return new;
end;
$$;

-- Reparationsvejen for gamle numre (fx UUID-stemplerne fra 120644-backfillet):
-- tildel et nyt nummer fra virksomhedens serie. Klienten vælger aldrig værdien
-- — tømningen udløser guardens nummergivning — og det gamle nummer genbruges
-- ikke (løkken springer optagne numre over).
create or replace function public.renumber_asset(p_asset_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_tag text;
begin
  select a.company_id into v_company from public.assets a where a.id = p_asset_id;
  if v_company is null then
    raise exception 'asset_not_found';
  end if;
  if not public.can_write_assets(v_company) then
    raise exception 'no_access';
  end if;
  update public.assets set asset_tag = null where id = p_asset_id
  returning asset_tag into v_tag;
  return v_tag;
end;
$$;

revoke all on function public.renumber_asset(uuid) from public;
grant execute on function public.renumber_asset(uuid) to authenticated;

-- Batchen retur i talorden: længde-først gør 'DCA-8' < 'DCA-10' (ens præfiks i
-- en batch, så længden afgør cifferantallet). Ellers uændret.
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
  select created.id, created.asset_tag from created
  order by char_length(created.asset_tag), created.asset_tag;
end;
$$;
