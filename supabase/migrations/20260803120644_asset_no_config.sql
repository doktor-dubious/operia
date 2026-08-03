-- Aktiv-nr. (assets.asset_tag) bliver obligatorisk og pr.-kunde-unikt, og
-- systemet tildeler det selv. Kunden vælger nummerserien under
-- Konfigurér → Aktivdata:
--   'uuid'       — gen_random_uuid() pr. aktiv (standard, kollisionsfri)
--   'sequential' — fortløbende tæller med valgfrit præfiks og valgfri fast
--                  længde (nulpolstret), fx præfiks 'DCA-' + længde 4 →
--                  DCA-0001, DCA-0002 …
--
-- Nummeret må ikke kunne tastes af klienten: New Asset-formularen viser det
-- skrivebeskyttet, og assets_guard udfylder det server-side, når en indsættelse
-- (import, API, ældre klient) ikke medbringer et. Det er dermed umuligt at
-- oprette et aktiv uden nummer, uanset hvilken vej indsættelsen kommer.

-- ---------------------------------------------------------------------------
-- Konfigurationen — pr. kunde, med platformens standard som arvegrundlag
-- ---------------------------------------------------------------------------
alter table public.companies
  add column asset_no_type text not null default 'uuid',
  add column asset_no_prefix text not null default '',
  add column asset_no_length int;

alter table public.companies
  add constraint companies_asset_no_type_check
    check (asset_no_type in ('uuid', 'sequential')),
  -- Præfikset ender i en menneskelæst label: ingen kontroltegn, kort nok til
  -- at nummeret stadig kan skrives af.
  add constraint companies_asset_no_prefix_check
    check (char_length(asset_no_prefix) <= 16 and asset_no_prefix !~ '[[:cntrl:]]'),
  add constraint companies_asset_no_length_check
    check (asset_no_length is null or asset_no_length between 1 and 12);

alter table public.platform_settings
  add column asset_no_type text not null default 'uuid',
  add column asset_no_prefix text not null default '',
  add column asset_no_length int;

alter table public.platform_settings
  add constraint platform_settings_asset_no_type_check
    check (asset_no_type in ('uuid', 'sequential')),
  add constraint platform_settings_asset_no_prefix_check
    check (char_length(asset_no_prefix) <= 16 and asset_no_prefix !~ '[[:cntrl:]]'),
  add constraint platform_settings_asset_no_length_check
    check (asset_no_length is null or asset_no_length between 1 and 12);

-- Nye kunder arver platformens standard (Operia → Aktivdata). Kolonne-defaults
-- kan ikke slå op i en anden tabel, så det sker i en trigger. Opret-fladen
-- sætter aldrig felterne selv — de vælges bagefter på kundens egen side.
create or replace function public.companies_asset_no_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select p.asset_no_type, p.asset_no_prefix, p.asset_no_length
    into new.asset_no_type, new.asset_no_prefix, new.asset_no_length
  from public.platform_settings p
  where p.id;
  return new;
end;
$$;

create trigger companies_asset_no_defaults
  before insert on public.companies
  for each row execute function public.companies_asset_no_defaults();

-- ---------------------------------------------------------------------------
-- Tælleren (samme mønster som parcel_barcode_seq)
-- ---------------------------------------------------------------------------
create table public.asset_no_seq (
  company_id uuid primary key references public.companies (id) on delete cascade,
  last_value bigint not null default 0
);

alter table public.asset_no_seq enable row level security;
-- Ingen policies med vilje: tælleren røres kun af next_asset_no_unchecked
-- (security definer). Ingen klient skal kunne læse eller sætte den.
revoke all on public.asset_no_seq from anon, authenticated;

-- Selve nummergiveren, UDEN adgangskontrol — kaldes fra assets_guard, hvor RLS
-- allerede har godkendt indsættelsen. Er ikke grantet til authenticated.
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

    candidate := v_prefix
      || case when v_len is null then v::text else lpad(v::text, v_len, '0') end;

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

revoke all on function public.next_asset_no_unchecked(uuid) from public, anon, authenticated;

-- Klientens indgang: New Asset-formularen henter nummeret her, så feltet kan
-- vises skrivebeskyttet inden der gemmes. Klienten er utroværdig, så
-- virksomheden genverificeres.
create or replace function public.next_asset_no(p_company_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_company_id is null
     or not (p_company_id = public.current_company_id() or public.is_platform_admin()) then
    raise exception 'Ingen adgang til denne virksomhed';
  end if;
  return public.next_asset_no_unchecked(p_company_id);
end;
$$;

revoke all on function public.next_asset_no(uuid) from public;
grant execute on function public.next_asset_no(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Guarden udfylder nummeret, når indsættelsen ikke selv medbringer et
-- ---------------------------------------------------------------------------
-- Uændret tenant-validering; ny er kun asset_tag-blokken. Funktionen er nu
-- security definer, fordi den kalder next_asset_no_unchecked (som ikke er
-- grantet til authenticated). Sidegevinst: FK-opslagene nedenfor rammer nu
-- tabellerne uden om RLS, hvilket var hensigten hele vejen igennem.
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
  if tg_op = 'INSERT' and new.asset_tag is null then
    new.asset_tag := public.next_asset_no_unchecked(new.company_id);
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

-- ---------------------------------------------------------------------------
-- Obligatorisk. Unikheden pr. kunde findes allerede
-- (assets_company_id_asset_tag_key).
-- ---------------------------------------------------------------------------
update public.assets
set asset_tag = gen_random_uuid()::text
where asset_tag is null or btrim(asset_tag) = '';

alter table public.assets
  alter column asset_tag set not null,
  add constraint assets_asset_tag_sane
    check (btrim(asset_tag) <> '' and char_length(asset_tag) <= 64 and asset_tag !~ '[[:cntrl:]]');
