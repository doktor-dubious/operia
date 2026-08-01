-- Aktiv-flowet, del 3: flow-RPC'er (tjek ud/ind, flyt, service, udfasning) +
-- medarbejderkobling på udlån + håndterminal-featurenøgler.
--
-- Al flow-skrivning går gennem SECURITY DEFINER-RPC'er (browseren/appen er
-- utroværdig): rettigheder gentjekkes server-side, status + tilknyttede rækker
-- følges ad, og hver handling skriver sin specifikke hændelse i asset_events
-- (den generiske assets-trigger undertrykkes med operia.asset_flow_rpc).
-- Frie noter gemmes som asset_documents (sletbare ved behov, GDPR) — aldrig i
-- den immutable hændelseslog; hændelses-detail indeholder kun id-referencer og
-- preset-nøgler.

-- ---------------------------------------------------------------------------
-- Rettighedsgrænse for flowet: også håndterings-rollerne (som pakkeflowet).
-- can_write_assets (manager/asset_manager) forbliver grænsen for selve
-- registeret og for udfasning/genindsættelse.
-- ---------------------------------------------------------------------------
create or replace function public.can_operate_assets(p_company_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (
    p_company_id = public.current_company_id()
    and public.has_any_role('manager', 'asset_manager', 'asset_handler', 'handheld_asset_handler')
  )
  or public.is_platform_admin()
$$;

revoke execute on function public.can_operate_assets(uuid) from public, anon;
grant execute on function public.can_operate_assets(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Udlån kan nu pege på en medarbejder fra kartoteket. Kontaktkopien (navn,
-- e-mail, telefon) består — den anonymiseres automatisk ved aflevering
-- (20260720130100); selve medarbejder-referencen er chain of custody og
-- håndteres af medarbejder-anonymiseringen som parcels.receiver_employee_id.
-- ---------------------------------------------------------------------------
alter table public.asset_loans
  add column employee_id uuid references public.employees (id) on delete set null;

create index asset_loans_employee_idx on public.asset_loans (employee_id);

-- Fælles intern hjælper: gem en flow-note som dokumentation. Kaldes kun fra
-- RPC'erne herunder (ingen grants) — klienters egne noter går direkte i
-- asset_documents via INSERT-politikken.
create or replace function public.asset_flow_note(
  p_asset_id uuid,
  p_company_id uuid,
  p_note text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if nullif(btrim(coalesce(p_note, '')), '') is null then
    return;
  end if;
  insert into public.asset_documents (asset_id, company_id, note, created_by)
  values (p_asset_id, p_company_id, btrim(p_note), auth.uid());
end;
$$;

revoke execute on function public.asset_flow_note(uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tjek ud: fast tildeling til en medarbejder (in_stock → assigned)
-- ---------------------------------------------------------------------------
create or replace function public.checkout_asset(
  p_asset_id uuid,
  p_employee_id uuid,
  p_note text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_asset public.assets;
  v_employee public.employees;
begin
  select * into v_asset from public.assets where id = p_asset_id;
  if not found then
    raise exception 'asset_not_found' using errcode = 'P0002';
  end if;
  if not public.can_operate_assets(v_asset.company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not v_asset.is_active then
    raise exception 'asset_inactive' using errcode = 'P0001';
  end if;
  if v_asset.status <> 'in_stock' then
    raise exception 'asset_not_in_stock' using errcode = 'P0001';
  end if;

  select * into v_employee from public.employees
    where id = p_employee_id and company_id = v_asset.company_id;
  if not found then
    raise exception 'employee_not_found' using errcode = 'P0002';
  end if;
  if not v_employee.is_active then
    raise exception 'employee_inactive' using errcode = 'P0001';
  end if;

  perform set_config('operia.asset_flow_rpc', '1', true);
  update public.assets
     set status = 'assigned',
         assigned_to_employee_id = v_employee.id,
         assigned_at = now()
   where id = v_asset.id;

  insert into public.asset_events
    (asset_id, company_id, event_type, from_status, to_status,
     from_location_id, to_location_id, actor_user_id, detail)
  values
    (v_asset.id, v_asset.company_id, 'checked_out', v_asset.status, 'assigned',
     v_asset.location_id, v_asset.location_id, auth.uid(),
     jsonb_build_object('employee_id', v_employee.id));

  perform public.asset_flow_note(v_asset.id, v_asset.company_id, p_note);
end;
$$;

revoke execute on function public.checkout_asset(uuid, uuid, text) from public, anon;
grant execute on function public.checkout_asset(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Tjek ind: aktivet er tilbage på lager (assigned/on_loan/service → in_stock).
-- Lukker et evt. åbent udlån (anonymiseringstriggeren rydder kontaktkopien).
-- Valgfrit: ny placering og opdateret stand.
-- ---------------------------------------------------------------------------
create or replace function public.checkin_asset(
  p_asset_id uuid,
  p_location_id uuid default null,
  p_condition text default null,
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
  if not public.can_operate_assets(v_asset.company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_asset.status not in ('assigned', 'on_loan', 'service') then
    raise exception 'asset_not_out' using errcode = 'P0001';
  end if;
  if p_location_id is not null and not exists (
    select 1 from public.asset_locations l
    where l.id = p_location_id and l.company_id = v_asset.company_id
  ) then
    raise exception 'location_not_found' using errcode = 'P0002';
  end if;

  -- Luk åbent udlån FØR statusskiftet, så assets_status_guard ikke ruller
  -- on_loan tilbage. Står aktivet on_loan uden åbent lån (historisk skævhed),
  -- helbreder tjek-ind blot statussen.
  update public.asset_loans
     set returned_at = now(), returned_by = auth.uid()
   where asset_id = v_asset.id and returned_at is null
   returning id into v_loan_id;

  perform set_config('operia.asset_flow_rpc', '1', true);
  update public.assets
     set status = 'in_stock',
         assigned_to_employee_id = null,
         assigned_at = null,
         service_vendor = null,
         service_expected_back = null,
         location_id = coalesce(p_location_id, location_id),
         condition = coalesce(nullif(btrim(coalesce(p_condition, '')), ''), condition)
   where id = v_asset.id;

  insert into public.asset_events
    (asset_id, company_id, event_type, from_status, to_status,
     from_location_id, to_location_id, actor_user_id, detail)
  values
    (v_asset.id, v_asset.company_id, 'checked_in', v_asset.status, 'in_stock',
     v_asset.location_id, coalesce(p_location_id, v_asset.location_id), auth.uid(),
     jsonb_build_object(
       'closed_loan_id', v_loan_id,
       'from_employee', v_asset.assigned_to_employee_id,
       'condition_updated', nullif(btrim(coalesce(p_condition, '')), '') is not null
     ));

  perform public.asset_flow_note(v_asset.id, v_asset.company_id, p_note);
end;
$$;

revoke execute on function public.checkin_asset(uuid, uuid, text, text) from public, anon;
grant execute on function public.checkin_asset(uuid, uuid, text, text) to authenticated;

-- return_asset (webbens eksisterende "registrér aflevering") bliver et alias
-- for tjek-ind, så begge veje giver samme hændelser og samme selvhelende
-- adfærd — men beholder kravet om et åbent udlån.
create or replace function public.return_asset(p_asset_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.asset_loans
    where asset_id = p_asset_id and returned_at is null
  ) then
    raise exception 'no_open_loan' using errcode = 'P0001';
  end if;
  perform public.checkin_asset(p_asset_id);
end;
$$;

revoke execute on function public.return_asset(uuid) from public, anon;
grant execute on function public.return_asset(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Flyt: ny placering, status uændret. on_loan kan ikke flyttes (aktivet er
-- fysisk ude af huset).
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

revoke execute on function public.move_asset(uuid, uuid, text) from public, anon;
grant execute on function public.move_asset(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Til service (in_stock/assigned → service). En evt. tildeling består, så
-- oversigten kan vise "tildelt X, til service"; tjek-ind afslutter begge dele.
-- ---------------------------------------------------------------------------
create or replace function public.send_asset_to_service(
  p_asset_id uuid,
  p_vendor text default null,
  p_expected_back date default null,
  p_note text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_asset public.assets;
begin
  select * into v_asset from public.assets where id = p_asset_id;
  if not found then
    raise exception 'asset_not_found' using errcode = 'P0002';
  end if;
  if not public.can_operate_assets(v_asset.company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not v_asset.is_active then
    raise exception 'asset_inactive' using errcode = 'P0001';
  end if;
  if v_asset.status not in ('in_stock', 'assigned') then
    raise exception 'asset_not_serviceable' using errcode = 'P0001';
  end if;

  perform set_config('operia.asset_flow_rpc', '1', true);
  update public.assets
     set status = 'service',
         service_vendor = nullif(btrim(coalesce(p_vendor, '')), ''),
         service_expected_back = p_expected_back
   where id = v_asset.id;

  -- Leverandøren står kun i assets (sletbar kolonne) — ikke i den immutable log.
  insert into public.asset_events
    (asset_id, company_id, event_type, from_status, to_status, actor_user_id, detail)
  values
    (v_asset.id, v_asset.company_id, 'service_sent', v_asset.status, 'service', auth.uid(),
     jsonb_build_object('expected_back', p_expected_back));

  perform public.asset_flow_note(v_asset.id, v_asset.company_id, p_note);
end;
$$;

revoke execute on function public.send_asset_to_service(uuid, text, date, text) from public, anon;
grant execute on function public.send_asset_to_service(uuid, text, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Udfasning (preset-årsag, så den immutable log er fri for fritekst) og
-- genindsættelse. Register-niveau: kræver can_write_assets.
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

revoke execute on function public.retire_asset(uuid, text, text) from public, anon;
grant execute on function public.retire_asset(uuid, text, text) to authenticated;

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
  if v_asset.status <> 'retired' then
    raise exception 'not_retired' using errcode = 'P0001';
  end if;

  perform set_config('operia.asset_flow_rpc', '1', true);
  update public.assets
     set status = 'in_stock', retired_at = null, retired_reason = null
   where id = v_asset.id;

  insert into public.asset_events
    (asset_id, company_id, event_type, from_status, to_status, actor_user_id)
  values
    (v_asset.id, v_asset.company_id, 'reinstated', 'retired', 'in_stock', auth.uid());
end;
$$;

revoke execute on function public.reinstate_asset(uuid) from public, anon;
grant execute on function public.reinstate_asset(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- lend_asset udvides med valgfri medarbejder fra kartoteket (kontaktdata
-- snapshottes derfra, eksplicitte parametre vinder) og åbnes for
-- flow-rollerne. Gamle signatur droppes (overload-tvetydighed, jf.
-- 20260717140000). Hændelsen 'loaned' skrives eksplicit — kun id-referencer.
-- ---------------------------------------------------------------------------
drop function if exists public.lend_asset(uuid, text, text, text, text, integer, text);

create or replace function public.lend_asset(
  p_asset_id uuid,
  p_to_name text default null,
  p_to_address text default null,
  p_to_email text default null,
  p_to_phone text default null,
  p_ttl_hours integer default null,
  p_note text default null,
  p_employee_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_asset public.assets;
  v_employee public.employees;
  v_name text := nullif(btrim(coalesce(p_to_name, '')), '');
  v_email text := nullif(btrim(coalesce(p_to_email, '')), '');
  v_phone text := nullif(btrim(coalesce(p_to_phone, '')), '');
  v_expires timestamptz;
  v_loan_id uuid;
begin
  select * into v_asset from public.assets where id = p_asset_id;
  if not found then
    raise exception 'asset_not_found' using errcode = 'P0002';
  end if;
  if not public.can_operate_assets(v_asset.company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not v_asset.is_active then
    raise exception 'asset_inactive' using errcode = 'P0001';
  end if;
  if v_asset.status <> 'in_stock' then
    raise exception 'asset_not_in_stock' using errcode = 'P0001';
  end if;

  if p_employee_id is not null then
    select * into v_employee from public.employees
      where id = p_employee_id and company_id = v_asset.company_id;
    if not found then
      raise exception 'employee_not_found' using errcode = 'P0002';
    end if;
    if not v_employee.is_active then
      raise exception 'employee_inactive' using errcode = 'P0001';
    end if;
    v_name := coalesce(v_name, nullif(btrim(coalesce(v_employee.full_name, '')), ''));
    v_email := coalesce(v_email, nullif(btrim(coalesce(v_employee.email, '')), ''));
    v_phone := coalesce(v_phone, nullif(btrim(coalesce(v_employee.phone, '')), ''));
  end if;

  if v_name is null then
    raise exception 'name_required' using errcode = 'P0001';
  end if;
  if v_email is null and v_phone is null then
    raise exception 'contact_required' using errcode = 'P0001';
  end if;
  -- Samme løse form som klienten (isValidEmail i web/src/lib/validation.ts).
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
    company_id, asset_id, employee_id, to_name, to_address, to_email, to_phone,
    note, expires_at, lent_by
  ) values (
    v_asset.company_id, v_asset.id, p_employee_id, v_name,
    nullif(btrim(coalesce(p_to_address, '')), ''), v_email, v_phone,
    nullif(btrim(coalesce(p_note, '')), ''), v_expires, auth.uid()
  ) returning id into v_loan_id;

  perform set_config('operia.asset_loan_rpc', '1', true);
  perform set_config('operia.asset_flow_rpc', '1', true);
  update public.assets set status = 'on_loan' where id = v_asset.id;

  insert into public.asset_events
    (asset_id, company_id, event_type, from_status, to_status, actor_user_id, detail)
  values
    (v_asset.id, v_asset.company_id, 'loaned', 'in_stock', 'on_loan', auth.uid(),
     jsonb_build_object('loan_id', v_loan_id, 'employee_id', p_employee_id, 'expires_at', v_expires));

  -- Ingen record_audit her: audit_asset_events_trg spejler 'loaned' (og alle
  -- øvrige flow-hændelser) minimeret til audit_log — én post pr. handling.
  return v_loan_id;
end;
$$;

revoke execute on function public.lend_asset(uuid, text, text, text, text, integer, text, uuid)
  from public, anon;
grant execute on function public.lend_asset(uuid, text, text, text, text, integer, text, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Håndterminal-featurenøgler for aktiv-flowet (produkt: assets). Kunder med
-- aktiv-produktet får dem tildelt, så fliserne dukker op (has() viser kun
-- eksplicit tildelte features, når mindst én hh_-feature er konfigureret).
-- ---------------------------------------------------------------------------
insert into public.feature_catalog (key, product_key, name, description, name_en, description_en) values
  ('hh_asset_checkout', 'assets', 'Håndterminal: Tjek aktiv ud',
   'Tjek aktiver ud til en medarbejder eller lån dem ud på håndterminalen',
   'Handheld: Check out asset', 'Check assets out to an employee or lend them out on the handheld'),
  ('hh_asset_checkin', 'assets', 'Håndterminal: Tjek aktiv ind',
   'Tjek aktiver ind på håndterminalen (scan → på lager)',
   'Handheld: Check in asset', 'Check assets in on the handheld (scan → in stock)'),
  ('hh_asset_move', 'assets', 'Håndterminal: Flyt aktiv',
   'Flyt aktiver til en ny placering på håndterminalen',
   'Handheld: Move asset', 'Relocate assets on the handheld'),
  ('hh_asset_document', 'assets', 'Håndterminal: Dokumentér aktiv',
   'Dokumentér aktiver med fotos og noter på håndterminalen',
   'Handheld: Document asset', 'Document assets with photos and notes on the handheld'),
  ('hh_asset_search', 'assets', 'Håndterminal: Søg aktiv',
   'Søg aktiver og se historik på håndterminalen',
   'Handheld: Search assets', 'Search assets and view history on the handheld')
on conflict (key) do nothing;

insert into public.company_features (company_id, feature_key)
select cp.company_id, f.key
from public.company_products cp
cross join (values
  ('hh_asset_checkout'), ('hh_asset_checkin'), ('hh_asset_move'),
  ('hh_asset_document'), ('hh_asset_search')
) as f(key)
where cp.product_key = 'assets'
on conflict (company_id, feature_key) do nothing;
