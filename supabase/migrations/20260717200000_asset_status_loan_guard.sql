-- Håndhæv status↔lån-invarianten på ASSETS-siden.
--
-- 20260717090000 låste asset_loans (ingen skrivepolitik; al skrivning via
-- lend_asset()/return_asset()), men assets.status var stadig frit skrivbar
-- gennem assets_write-politikken. En direkte skrivning — CSV-importen, et
-- API-kald — kunne derfor skille status og lånerække ad: 'in_stock' med et
-- åbent lån (returen kan aldrig lukkes fra UI'et, nyt udlån vælter på
-- asset_loans_open_uniq) eller 'on_loan' uden lånerække (returen fejler altid
-- med no_open_loan).
--
-- Reglen håndhæves i en trigger og ikke i klienterne (browseren er
-- utroværdig; jf. parcels_guard):
--   * on_loan kan KUN sættes af lend_asset() — direkte forsøg afvises.
--   * on_loan kan kun forlades af return_asset(), så længe et åbent lån
--     findes; direkte skrivninger får statussen bevaret i stedet for en fejl,
--     så en CSV-import med en forældet statuskolonne ikke vælter midtvejs —
--     rækkens øvrige kolonner opdateres, lånet består.
--   * Står et aktiv 'on_loan' UDEN åbent lån (historisk skævhed), må enhver
--     rette det — reglen er selvhelende.
-- Funktionerne markerer sig med et transaktionslokalt flag; PostgREST kører
-- hvert kald i sin egen transaktion, så flaget kan ikke lække til andre kald.

create or replace function public.assets_status_guard()
returns trigger
language plpgsql
as $$
begin
  if current_setting('operia.asset_loan_rpc', true) = '1' then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.status = 'on_loan' and new.status <> 'on_loan' and exists (
      select 1 from public.asset_loans l
      where l.asset_id = new.id and l.returned_at is null
    ) then
      new.status := 'on_loan';
    elsif new.status = 'on_loan' and old.status <> 'on_loan' then
      raise exception 'use_lend_asset' using errcode = 'P0001';
    end if;
  elsif new.status = 'on_loan' then
    raise exception 'use_lend_asset' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger assets_status_guard
  before insert or update of status on public.assets
  for each row execute function public.assets_status_guard();

-- lend_asset genskabes med flaget sat før statusskrivningen — ellers uændret
-- fra 20260717140000 (7-argument-versionen med note).
create or replace function public.lend_asset(
  p_asset_id uuid,
  p_to_name text,
  p_to_address text default null,
  p_to_email text default null,
  p_to_phone text default null,
  p_ttl_hours integer default null,
  p_note text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_asset public.assets;
  v_email text := nullif(btrim(p_to_email), '');
  v_phone text := nullif(btrim(p_to_phone), '');
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
  if v_email is null and v_phone is null then
    raise exception 'contact_required' using errcode = 'P0001';
  end if;
  -- Samme løse form som klienten (isValidEmail i web/src/lib/validation.ts):
  -- fang tastefejl, afgør ikke om adressen findes. Al skrivning går gennem
  -- denne funktion (asset_loans har ingen skrivepolitik), så her er stedet.
  if v_email is not null and v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'bad_email' using errcode = 'P0001';
  end if;
  if p_ttl_hours is not null and p_ttl_hours <= 0 then
    raise exception 'bad_ttl' using errcode = 'P0001';
  end if;

  v_expires := case
    when p_ttl_hours is null then null
    else now() + make_interval(hours => p_ttl_hours)
  end;

  insert into public.asset_loans (
    company_id, asset_id, to_name, to_address, to_email, to_phone, note, expires_at, lent_by
  ) values (
    v_asset.company_id, v_asset.id, btrim(p_to_name),
    nullif(btrim(p_to_address), ''), v_email, v_phone, nullif(btrim(p_note), ''),
    v_expires, auth.uid()
  ) returning id into v_loan_id;

  perform set_config('operia.asset_loan_rpc', '1', true);
  update public.assets set status = 'on_loan' where id = v_asset.id;

  perform public.record_audit(
    v_asset.company_id, 'asset.lent', 'asset', v_asset.id::text,
    coalesce(v_asset.name, v_asset.asset_tag),
    jsonb_build_object('loan_id', v_loan_id, 'to_name', btrim(p_to_name), 'expires_at', v_expires)
  );
  return v_loan_id;
end;
$$;

-- return_asset ligeså — ellers uændret fra 20260717090000.
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

  perform set_config('operia.asset_loan_rpc', '1', true);
  update public.assets set status = 'in_stock' where id = v_asset.id;

  perform public.record_audit(
    v_asset.company_id, 'asset.returned', 'asset', v_asset.id::text,
    coalesce(v_asset.name, v_asset.asset_tag),
    jsonb_build_object('loan_id', v_loan_id)
  );
end;
$$;

-- Reparér data der allerede er skilt ad (importen kunne nå at gøre det før
-- denne migration): et åbent lån vinder over en afvegen status. Flaget sættes
-- så triggeren ovenfor ikke afviser selve reparationen (db push kører
-- migrationen i én transaktion, så flaget dør med den).
select set_config('operia.asset_loan_rpc', '1', true);
update public.assets a
  set status = 'on_loan'
  where a.status <> 'on_loan'
    and exists (
      select 1 from public.asset_loans l
      where l.asset_id = a.id and l.returned_at is null
    );
