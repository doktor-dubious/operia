-- Aktivstatus som enum + udlån (Aktiver-modulet).
--
-- Status var hidtil fri tekst fra importen ('På lager', 'I brug', 'Til
-- reparation', 'Udgået'). Prototypens statussæt gøres nu kanonisk og
-- håndhæves som enum, så «Lån ud» kan bygge på en pålidelig tilstand: kun et
-- aktiv på lager kan lånes ud. Importen skriver stadig status, men kun via de
-- kanoniske nøgler eller deres da/en-etiketter (asset_status_from_text).
--
-- Udlån gemmes i asset_loans. Tabellen har BEVIDST ingen skrivepolitik:
-- browseren er utroværdig, og status + udlånsrække skal følges ad — derfor går
-- al skrivning gennem lend_asset()/return_asset() (SECURITY DEFINER), som
-- gentjekker rettighederne server-side.

create type public.asset_status as enum
  ('in_stock', 'assigned', 'on_loan', 'service', 'retired');

-- Fri tekst → kanonisk nøgle. Bruges til backfillen herunder og af importen;
-- klientspejlet er ASSET_STATUS_SYNONYMS i web/src/lib/module-import.ts —
-- hold de to i sync (importen udelader dog on_loan-aliasserne med vilje, se
-- 20260717200000). Ukendt tekst giver null (kalderen bestemmer faldet).
create or replace function public.asset_status_from_text(p_text text)
returns public.asset_status language sql immutable as $$
  select case lower(btrim(coalesce(p_text, '')))
    when 'in_stock'       then 'in_stock'
    when 'in stock'       then 'in_stock'
    when 'på lager'       then 'in_stock'
    when 'pa lager'       then 'in_stock'
    when 'assigned'       then 'assigned'
    when 'in use'         then 'assigned'
    when 'i brug'         then 'assigned'
    when 'on_loan'        then 'on_loan'
    when 'on loan'        then 'on_loan'
    when 'lent out'       then 'on_loan'
    when 'udlånt'         then 'on_loan'
    when 'udlaant'        then 'on_loan'
    when 'service'        then 'service'
    when 'repair'         then 'service'
    when 'til service'    then 'service'
    when 'til reparation' then 'service'
    when 'retired'        then 'retired'
    when 'udfaset'        then 'retired'
    when 'udgået'         then 'retired'
    when 'udgaaet'        then 'retired'
    else null
  end::public.asset_status
$$;

-- Backfill: kendt tekst mappes, ukendt/tom tekst falder til 'in_stock'.
alter table public.assets
  alter column status type public.asset_status
    using coalesce(public.asset_status_from_text(status), 'in_stock'::public.asset_status);

alter table public.assets
  alter column status set default 'in_stock';
alter table public.assets
  alter column status set not null;

create table public.asset_loans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  asset_id uuid not null references public.assets (id) on delete cascade,
  to_name text not null check (btrim(to_name) <> ''),
  to_address text,
  to_email text,
  to_phone text,
  expires_at timestamptz,        -- null = intet udløb
  lent_at timestamptz not null default now(),
  lent_by uuid references auth.users (id) on delete set null,
  returned_at timestamptz,
  returned_by uuid references auth.users (id) on delete set null,
  -- «En af Email eller SMS er påkrævet»
  constraint asset_loans_contact_required
    check (nullif(btrim(to_email), '') is not null or nullif(btrim(to_phone), '') is not null)
);

-- Højst ét åbent udlån pr. aktiv — bagstopper for status-maskinen.
create unique index asset_loans_open_uniq
  on public.asset_loans (asset_id) where returned_at is null;

create index asset_loans_asset_idx on public.asset_loans (asset_id, lent_at desc);

alter table public.asset_loans enable row level security;

-- Kun læsning: egen virksomhed + platform-admins. Ingen skrivepolitik med
-- vilje — se hovedet.
create policy asset_loans_select on public.asset_loans
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

grant select on public.asset_loans to authenticated;

-- Samme grænse som assets_write-politikken; gentjekkes her fordi funktionerne
-- er SECURITY DEFINER og dermed omgår RLS.
create or replace function public.can_write_assets(p_company_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (p_company_id = public.current_company_id() and public.has_role('manager'))
      or public.is_platform_admin()
$$;

revoke execute on function public.can_write_assets(uuid) from public, anon;
grant execute on function public.can_write_assets(uuid) to authenticated;

-- Lån et aktiv ud. p_ttl_hours: null = intet udløb (som platform_settings
-- .locker_loan_ttl_hours, der er dialogens startværdi).
create or replace function public.lend_asset(
  p_asset_id uuid,
  p_to_name text,
  p_to_address text default null,
  p_to_email text default null,
  p_to_phone text default null,
  p_ttl_hours integer default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_asset public.assets;
  v_expires timestamptz;
  v_loan_id uuid;
begin
  select * into v_asset from public.assets where id = p_asset_id;
  if not found then
    raise exception 'asset_not_found' using errcode = 'P0002';
  end if;
  if not public.can_write_assets(v_asset.company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not v_asset.is_active then
    raise exception 'asset_inactive' using errcode = 'P0001';
  end if;
  if v_asset.status <> 'in_stock' then
    raise exception 'asset_not_in_stock' using errcode = 'P0001';
  end if;
  if nullif(btrim(p_to_name), '') is null then
    raise exception 'name_required' using errcode = 'P0001';
  end if;
  if nullif(btrim(p_to_email), '') is null and nullif(btrim(p_to_phone), '') is null then
    raise exception 'contact_required' using errcode = 'P0001';
  end if;
  if p_ttl_hours is not null and p_ttl_hours <= 0 then
    raise exception 'bad_ttl' using errcode = 'P0001';
  end if;

  v_expires := case
    when p_ttl_hours is null then null
    else now() + make_interval(hours => p_ttl_hours)
  end;

  insert into public.asset_loans (
    company_id, asset_id, to_name, to_address, to_email, to_phone, expires_at, lent_by
  ) values (
    v_asset.company_id, v_asset.id, btrim(p_to_name),
    nullif(btrim(p_to_address), ''), nullif(btrim(p_to_email), ''), nullif(btrim(p_to_phone), ''),
    v_expires, auth.uid()
  ) returning id into v_loan_id;

  update public.assets set status = 'on_loan' where id = v_asset.id;

  perform public.record_audit(
    v_asset.company_id, 'asset.lent', 'asset', v_asset.id::text,
    coalesce(v_asset.name, v_asset.asset_tag),
    jsonb_build_object('loan_id', v_loan_id, 'to_name', btrim(p_to_name), 'expires_at', v_expires)
  );
  return v_loan_id;
end;
$$;

revoke execute on function public.lend_asset(uuid, text, text, text, text, integer)
  from public, anon;
grant execute on function public.lend_asset(uuid, text, text, text, text, integer)
  to authenticated;

-- Modstykket til lend_asset: luk det åbne udlån og sæt aktivet på lager igen.
create or replace function public.return_asset(p_asset_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_asset public.assets;
  v_loan_id uuid;
begin
  select * into v_asset from public.assets where id = p_asset_id;
  if not found then
    raise exception 'asset_not_found' using errcode = 'P0002';
  end if;
  if not public.can_write_assets(v_asset.company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  update public.asset_loans
    set returned_at = now(), returned_by = auth.uid()
    where asset_id = v_asset.id and returned_at is null
    returning id into v_loan_id;
  if v_loan_id is null then
    raise exception 'no_open_loan' using errcode = 'P0001';
  end if;

  update public.assets set status = 'in_stock' where id = v_asset.id;

  perform public.record_audit(
    v_asset.company_id, 'asset.returned', 'asset', v_asset.id::text,
    coalesce(v_asset.name, v_asset.asset_tag),
    jsonb_build_object('loan_id', v_loan_id)
  );
end;
$$;

revoke execute on function public.return_asset(uuid) from public, anon;
grant execute on function public.return_asset(uuid) to authenticated;
