-- Grænsefladetekster ("app_labels"): kunde- og platform-overstyring af app'ens
-- i18n-nøgler. Afløser den gamle product_text_override-model, hvor nøglen var
-- et slug af den DANSKE standardtekst pr. produkt — den knækkede så snart en
-- standardtekst blev omformuleret, og dækkede kun ~85 håndskrevne felter.
--
-- Ny model: text_key ER i18n-nøglen (fx 'receive.submitButton'), som i forvejen
-- er stabil og har standardtekster pr. sprog i locale-bundtet. Standardteksterne
-- ligger derfor IKKE i databasen — kun de rækker nogen faktisk har ændret.
--
-- Tre lag ved opslag (klienten fletter i den rækkefølge):
--   1. locale-filen (da.json / en.json)
--   2. platformens standard   (company_id is null — DCA, Operia → Tekster)
--   3. kundens overstyring    (company_id = virksomheden, Konfigurér → Tekster)
--
-- Den gamle tabel er tom i produktion (verificeret 2026-09-03), så den droppes
-- frem for at migreres.

drop function if exists public.replace_product_texts(uuid, text, jsonb);
drop table if exists public.product_text_override cascade;

create table public.app_text_override (
  id uuid primary key default gen_random_uuid(),
  -- null = platformens standard (gælder alle kunder). Ellers kundens egen.
  company_id uuid references public.companies (id) on delete cascade,
  platform text not null check (platform in ('web', 'handheld')),
  lang text not null check (lang ~ '^[a-z]{2}$'),
  text_key text not null check (length(text_key) between 1 and 200),
  value text not null check (length(value) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- NULLS NOT DISTINCT (Postgres 15+): platformrækkerne (company_id is null) skal
-- også være unikke pr. (platform, lang, text_key) — ellers ville en null-kolonne
-- tillade dubletter og gøre "hvilken standard gælder?" tvetydig.
create unique index app_text_override_key_idx
  on public.app_text_override (company_id, platform, lang, text_key)
  nulls not distinct;

-- Opslagsstien: hent alle rækker for ét sprog for (platform, kunde + platformlag).
create index app_text_override_lookup_idx
  on public.app_text_override (platform, lang, company_id);

create trigger app_text_override_set_updated_at
  before update on public.app_text_override
  for each row execute function public.set_updated_at();

alter table public.app_text_override enable row level security;

-- Læsning: alle godkendte brugere skal kunne læse platformlaget (det er deres
-- egen brugerflade) plus deres egen virksomheds lag.
create policy app_text_override_select on public.app_text_override
  for select to authenticated
  using (
    company_id is null
    or company_id = public.current_company_id()
    or public.is_platform_admin()
  );

-- Skrivning sker udelukkende gennem set_app_texts (SECURITY DEFINER), så et gem
-- altid giver præcis én revisionspost og autorisationen ikke kan omgås.
revoke all on public.app_text_override from anon, authenticated;
grant select on public.app_text_override to authenticated;

-- ---------------------------------------------------------------------------
-- Gem/nulstil tekster i ét kald.
--   p_entries: { "<lang>": { "<text_key>": "<værdi>" | null } }
-- null eller tom værdi = nulstil til standard (rækken slettes).
-- Returnerer antal satte + nulstillede rækker.
-- ---------------------------------------------------------------------------
create or replace function public.set_app_texts(
  p_company_id uuid,
  p_platform text,
  p_entries jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_set integer := 0;
  v_reset integer := 0;
begin
  if p_platform not in ('web', 'handheld') then
    raise exception 'unknown platform %', p_platform using errcode = '22023';
  end if;

  -- Platformlaget (company_id is null) er DCA's eget; kunder må kun røre deres
  -- egen række. Spejler app_text_override_select-politikkens afgrænsning.
  if p_company_id is null then
    if not public.is_platform_admin() then
      raise exception 'not authorized' using errcode = '42501';
    end if;
  elsif not ((p_company_id = public.current_company_id() and public.has_role('manager'))
             or public.is_platform_admin()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  with entries as (
    select l.key as lang, kv.key as text_key, nullif(btrim(kv.value), '') as value
    from jsonb_each(coalesce(p_entries, '{}'::jsonb)) as l,
         lateral jsonb_each_text(l.value) as kv
  ),
  cleared as (
    delete from public.app_text_override o
    using entries e
    where o.company_id is not distinct from p_company_id
      and o.platform = p_platform
      and o.lang = e.lang
      and o.text_key = e.text_key
      and e.value is null
    returning 1
  )
  select count(*) into v_reset from cleared;

  with entries as (
    select l.key as lang, kv.key as text_key, nullif(btrim(kv.value), '') as value
    from jsonb_each(coalesce(p_entries, '{}'::jsonb)) as l,
         lateral jsonb_each_text(l.value) as kv
  ),
  written as (
    insert into public.app_text_override (company_id, platform, lang, text_key, value)
    select p_company_id, p_platform, e.lang, e.text_key, e.value
    from entries e
    where e.value is not null
    on conflict (company_id, platform, lang, text_key)
      do update set value = excluded.value, updated_at = now()
    returning 1
  )
  select count(*) into v_set from written;

  if v_set > 0 or v_reset > 0 then
    perform public.record_audit(
      p_company_id, 'product_text.updated', 'product_text', p_platform, p_platform,
      jsonb_build_object('platform', p_platform, 'set', v_set, 'reset', v_reset,
                         'scope', case when p_company_id is null then 'platform' else 'company' end));
  end if;

  return jsonb_build_object('set', v_set, 'reset', v_reset);
end;
$$;

revoke execute on function public.set_app_texts(uuid, text, jsonb) from public, anon;
grant execute on function public.set_app_texts(uuid, text, jsonb) to authenticated;
