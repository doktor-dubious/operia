-- Afskrivnings-flowet (asset_status 'written_off', tilføjet i 20260801160000).
--
--  * write_off_asset: assigned/on_loan/service → written_off. Manager-niveau
--    (can_write_assets) — at opgive et krav er en ledelsesbeslutning. Et
--    åbent udlån lukkes (kravet er opgivet ⇒ formålet med lånerens
--    kontaktkopi er udtømt, så auto-anonymiseringen fra 20260720130100 er
--    netop rigtig); medarbejder-referencer (assigned_to/loan.employee_id)
--    bevares som sidst kendte holder. Lukningen stopper samtidig
--    lånepåmindelserne (dispatcheren ser kun åbne lån).
--  * Stregkode-unikhed: afskrevne undtages som udfasede — den fysiske label
--    forsvandt med aktivet, og erstatningen skal kunne registreres.
--  * reinstate_asset: dækker nu også written_off ("det dukkede op igen") →
--    in_stock; tildelingen ryddes (holderen har det jo ikke længere).
--  * move/retire konsekvensrettes; importen accepterer 'Afskrevet' m.fl.

-- ---------------------------------------------------------------------------
-- Kolonne + stregkode-unikhed
-- ---------------------------------------------------------------------------
alter table public.assets add column written_off_at timestamptz;

drop index public.assets_company_barcode_active_uniq;
create unique index assets_company_barcode_active_uniq
  on public.assets (company_id, barcode)
  where status not in ('retired', 'written_off');

-- ---------------------------------------------------------------------------
-- Afskriv
-- ---------------------------------------------------------------------------
create or replace function public.write_off_asset(
  p_asset_id uuid,
  p_note text default null
) returns void
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
  if v_asset.status not in ('assigned', 'on_loan', 'service') then
    raise exception 'asset_not_out' using errcode = 'P0001';
  end if;

  -- Luk åbent udlån FØR statusskiftet (som checkin_asset), så
  -- assets_status_guard ikke ruller on_loan tilbage.
  update public.asset_loans
     set returned_at = now(), returned_by = auth.uid()
   where asset_id = v_asset.id and returned_at is null
   returning id into v_loan_id;

  perform set_config('operia.asset_flow_rpc', '1', true);
  update public.assets
     set status = 'written_off',
         written_off_at = now()
   where id = v_asset.id;

  insert into public.asset_events
    (asset_id, company_id, event_type, from_status, to_status, actor_user_id, detail)
  values
    (v_asset.id, v_asset.company_id, 'written_off', v_asset.status, 'written_off', auth.uid(),
     jsonb_build_object(
       'closed_loan_id', v_loan_id,
       'from_employee', v_asset.assigned_to_employee_id
     ));

  perform public.asset_flow_note(v_asset.id, v_asset.company_id, p_note);
end;
$$;

revoke execute on function public.write_off_asset(uuid, text) from public, anon;
grant execute on function public.write_off_asset(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Genindsæt: nu også fra written_off ("aktivet dukkede op igen")
-- ---------------------------------------------------------------------------
create or replace function public.reinstate_asset(p_asset_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_asset public.assets;
begin
  select * into v_asset from public.assets where id = p_asset_id;
  if not found then
    raise exception 'asset_not_found' using errcode = 'P0002';
  end if;
  if not public.can_write_assets(v_asset.company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_asset.status not in ('retired', 'written_off') then
    raise exception 'not_retired' using errcode = 'P0001';
  end if;
  if v_asset.barcode is not null and exists (
    select 1 from public.assets a
    where a.company_id = v_asset.company_id
      and a.barcode = v_asset.barcode
      and a.id <> v_asset.id
      and a.status not in ('retired', 'written_off')
  ) then
    raise exception 'barcode_taken' using errcode = 'P0001';
  end if;

  perform set_config('operia.asset_flow_rpc', '1', true);
  update public.assets
     set status = 'in_stock',
         retired_at = null,
         retired_reason = null,
         written_off_at = null,
         assigned_to_employee_id = null,
         assigned_at = null
   where id = v_asset.id;

  insert into public.asset_events
    (asset_id, company_id, event_type, from_status, to_status, actor_user_id)
  values
    (v_asset.id, v_asset.company_id, 'reinstated', v_asset.status, 'in_stock', auth.uid());
end;
$$;

-- ---------------------------------------------------------------------------
-- Flyt: et afskrevet aktiv er fysisk væk og kan ikke flyttes. Ellers
-- uændret fra 20260801090200.
-- ---------------------------------------------------------------------------
create or replace function public.move_asset(
  p_asset_id uuid,
  p_location_id uuid,
  p_note text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_asset public.assets;
begin
  if p_location_id is null then
    raise exception 'location_required' using errcode = 'P0001';
  end if;
  select * into v_asset from public.assets where id = p_asset_id;
  if not found then
    raise exception 'asset_not_found' using errcode = 'P0002';
  end if;
  if not public.can_operate_assets(v_asset.company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_asset.status = 'on_loan' then
    raise exception 'asset_on_loan' using errcode = 'P0001';
  end if;
  if v_asset.status = 'written_off' then
    raise exception 'asset_written_off' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.asset_locations l
    where l.id = p_location_id and l.company_id = v_asset.company_id
  ) then
    raise exception 'location_not_found' using errcode = 'P0002';
  end if;
  if v_asset.location_id is not distinct from p_location_id then
    raise exception 'same_location' using errcode = 'P0001';
  end if;

  perform set_config('operia.asset_flow_rpc', '1', true);
  update public.assets set location_id = p_location_id where id = v_asset.id;

  insert into public.asset_events
    (asset_id, company_id, event_type, from_status, to_status,
     from_location_id, to_location_id, actor_user_id)
  values
    (v_asset.id, v_asset.company_id, 'moved', v_asset.status, v_asset.status,
     v_asset.location_id, p_location_id, auth.uid());

  perform public.asset_flow_note(v_asset.id, v_asset.company_id, p_note);
end;
$$;

-- ---------------------------------------------------------------------------
-- Udfas: rydder også written_off_at (omklassificering afskrevet → udfaset er
-- tilladt via RPC; UI'et skjuler knappen). Ellers uændret fra 20260801090200.
-- ---------------------------------------------------------------------------
create or replace function public.retire_asset(
  p_asset_id uuid,
  p_reason text,
  p_note text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_asset public.assets;
begin
  if p_reason is null or p_reason not in ('sold', 'scrapped', 'lost', 'damaged', 'other') then
    raise exception 'bad_reason' using errcode = 'P0001';
  end if;
  select * into v_asset from public.assets where id = p_asset_id;
  if not found then
    raise exception 'asset_not_found' using errcode = 'P0002';
  end if;
  if not public.can_write_assets(v_asset.company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_asset.status = 'on_loan' then
    raise exception 'asset_on_loan' using errcode = 'P0001';
  end if;
  if v_asset.status = 'retired' then
    raise exception 'already_retired' using errcode = 'P0001';
  end if;

  perform set_config('operia.asset_flow_rpc', '1', true);
  update public.assets
     set status = 'retired',
         retired_at = now(),
         retired_reason = p_reason,
         written_off_at = null,
         assigned_to_employee_id = null,
         assigned_at = null,
         service_vendor = null,
         service_expected_back = null
   where id = v_asset.id;

  insert into public.asset_events
    (asset_id, company_id, event_type, from_status, to_status, actor_user_id, detail)
  values
    (v_asset.id, v_asset.company_id, 'retired', v_asset.status, 'retired', auth.uid(),
     jsonb_build_object('reason', p_reason, 'from_employee', v_asset.assigned_to_employee_id));

  perform public.asset_flow_note(v_asset.id, v_asset.company_id, p_note);
end;
$$;

-- ---------------------------------------------------------------------------
-- Import: acceptér den nye status' etiketter. Klientspejl:
-- ASSET_STATUS_SYNONYMS i web/src/lib/module-import.ts.
-- ---------------------------------------------------------------------------
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
    when 'tildelt'        then 'assigned'
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
    when 'written_off'    then 'written_off'
    when 'written off'    then 'written_off'
    when 'afskrevet'      then 'written_off'
    else null
  end::public.asset_status
$$;

-- ---------------------------------------------------------------------------
-- Audit-niveau: en afskrivning er en undtagelseshændelse → 'warning'.
-- Genskabt fra den seneste version (20260730120100); klientspejlet er
-- levelOf i web/src/routes/_app/operia.logs.tsx.
-- ---------------------------------------------------------------------------
create or replace function public.audit_level(p_action text, p_detail jsonb)
returns text language sql immutable as $$
  select case
    when p_action = 'parcel.removed'
      or p_action like '%.failed' or p_action like '%\_failed' escape '\'
      or p_action like '%.bounced' or p_action like '%\_bounced' escape '\'
      or p_action = 'data_transfer.spoof_rejected'
      then 'error'
    when p_action = 'import.rejected'
      or p_action like '%.deleted'
      or p_action like '%.deactivated'
      or p_action like '%.anonymized'
      or p_action like '%.removed'
      or p_action like '%.revoked'
      or p_action like '%.disabled'
      or p_action like '%.written\_off' escape '\'
      or p_action like '%.overridden' or p_action like '%\_overridden' escape '\'
      or p_action like '%.complained' or p_action like '%\_complained' escape '\'
      or (p_action = 'parcel.status_changed'
          and coalesce(p_detail->>'to_status', '') in ('rejected', 'returned', 'removed'))
      then 'warning'
    else 'success'
  end
$$;
