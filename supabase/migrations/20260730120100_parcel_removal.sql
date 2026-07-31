-- Fjernelse af en fejlregistreret pakke (statussen 'removed' fra 20260730120000).
--
-- Kun manager/parcel_manager (eller platform-admin) kan gøre det, begrundelsen er
-- påkrævet, og handlingen efterlader tre spor:
--   • parcels.removed_reason/_by/_at — så skærmene kan vise hvad der skete,
--   • en 'removed'-linje i den uforanderlige parcel_events,
--   • 'parcel.removed' i revisionsloggen, klassificeret 'error' (det er en
--     datakorrektion i en kæde der ellers skal være ubrudt — den skal lyse rødt).

alter table public.parcels
  add column if not exists removed_reason text,
  add column if not exists removed_by uuid references auth.users (id) on delete set null,
  add column if not exists removed_at timestamptz;

comment on column public.parcels.removed_reason is
  'Managerens begrundelse for at annullere en fejlregistreret pakke (status removed).';

-- ---------------------------------------------------------------------------
-- Statusovergange: enhver ÅBEN status kan annulleres. 'delivered'/'returned'
-- kan ikke — de er afsluttet med kvittering/note, og at annullere dem ville
-- slette en sand hændelse. 'removed' er selv terminal.
-- ---------------------------------------------------------------------------
create or replace function public.parcel_transition_allowed(
  from_s public.parcel_status,
  to_s public.parcel_status
)
returns boolean
language sql
immutable
as $$
  select case from_s
    when 'unassigned' then to_s in ('registered', 'in_storage', 'returned', 'removed')
    when 'registered' then to_s in ('in_storage', 'in_transit', 'in_locker', 'delivered', 'rejected', 'returned', 'removed')
    when 'in_storage' then to_s in ('in_transit', 'in_locker', 'delivered', 'rejected', 'returned', 'removed')
    when 'in_transit' then to_s in ('in_storage', 'in_locker', 'delivered', 'rejected', 'returned', 'removed')
    when 'in_locker'  then to_s in ('delivered', 'returned', 'in_storage', 'removed')
    when 'rejected'   then to_s in ('returned', 'in_storage', 'removed')
    else false -- delivered, returned og removed er terminale
  end;
$$;

-- ---------------------------------------------------------------------------
-- Guard: en annulleret pakke står ikke længere nogen steder (som delivered/
-- returned). Ellers uændret fra 20260729100000.
-- ---------------------------------------------------------------------------
create or replace function public.parcels_guard()
returns trigger
language plpgsql
as $$
declare
  v_batch_receiver uuid;
begin
  if new.batch_id is not null then
    select b.receiver_employee_id into v_batch_receiver
    from public.parcel_batches b
    where b.id = new.batch_id and b.company_id = new.company_id;
    if not found then
      raise exception 'Batch tilhører ikke virksomheden';
    end if;
    new.receiver_employee_id := v_batch_receiver;
  end if;

  if tg_op = 'INSERT' then
    new.barcode := nullif(btrim(coalesce(new.barcode, '')), '');
    if new.barcode is null then
      new.barcode := public.generate_parcel_barcode(new.company_id);
    end if;

    if new.receiver_employee_id is null and new.status not in ('unassigned') then
      new.status := 'unassigned';
    end if;
    if new.receiver_employee_id is not null and new.status = 'unassigned' then
      new.status := 'registered';
    end if;
  elsif new.status is distinct from old.status then
    if not public.parcel_transition_allowed(old.status, new.status) then
      raise exception 'Ugyldig statusovergang: % -> %', old.status, new.status;
    end if;
    if new.status = 'delivered' and new.delivered_at is null then
      new.delivered_at := now();
    end if;
    -- Pakken har forladt huset (eller fandtes aldrig) ⇒ ingen placering.
    -- Bemærk: 'rejected' er med vilje IKKE med — se 20260717180000.
    if new.status in ('delivered', 'returned', 'removed') then
      new.storage_location_id := null;
    end if;
  end if;

  if new.receiver_employee_id is not null and not exists (
    select 1 from public.employees e
    where e.id = new.receiver_employee_id and e.company_id = new.company_id
  ) then
    raise exception 'Modtager tilhører ikke virksomheden';
  end if;
  if new.department_id is not null and not exists (
    select 1 from public.departments d
    where d.id = new.department_id and d.company_id = new.company_id
  ) then
    raise exception 'Afdeling tilhører ikke virksomheden';
  end if;
  if new.storage_location_id is not null and not exists (
    select 1 from public.storage_locations sl
    where sl.id = new.storage_location_id and sl.company_id = new.company_id
  ) then
    raise exception 'Placering tilhører ikke virksomheden';
  end if;
  if new.handling_class_id is not null and not exists (
    select 1 from public.handling_classes hc
    where hc.id = new.handling_class_id and hc.company_id = new.company_id
  ) then
    raise exception 'Håndteringsklasse tilhører ikke virksomheden';
  end if;
  if new.carrier_id is not null and not exists (
    select 1 from public.carriers c
    where c.id = new.carrier_id and c.company_id = new.company_id
  ) then
    raise exception 'Fragtfirma tilhører ikke virksomheden';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- GDPR-kæden: en annulleret pakke er IKKE en åben pakke. Uden dette ville en
-- fejlregistrering blokere anonymiseringen af en fratrådt medarbejder for evigt
-- — præcis den blindgyde fjernelsen skal løse.
-- ---------------------------------------------------------------------------
create or replace function public.employee_has_open_parcels(p_employee_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.parcels p
     where p.receiver_employee_id = p_employee_id
       and p.status not in ('delivered', 'rejected', 'returned', 'removed')
  );
$$;

-- ... og en fjernelse lukker pakken, så den ventende anonymisering kan køre.
create or replace function public.anonymize_on_parcel_closed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.receiver_employee_id is not null
     and new.status in ('delivered', 'rejected', 'returned', 'removed')
     and (tg_op = 'INSERT' or new.status is distinct from old.status)
     and exists (
       select 1 from public.employees e
        where e.id = new.receiver_employee_id
          and e.retired_at is not null
          and e.anonymized_at is null
     )
     and not public.employee_has_open_parcels(new.receiver_employee_id) then
    perform public.anonymize_employee_internal(new.receiver_employee_id);
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Selve handlingen. Tager en liste, så en fejlregistreret batch kan annulleres
-- i ét kald. Returnerer antal annullerede pakker.
-- ---------------------------------------------------------------------------
create or replace function public.remove_parcel(
  p_parcel_ids uuid[],
  p_reason text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_companies uuid[];
  v_company uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_parcel record;
  v_count int := 0;
begin
  if p_parcel_ids is null or array_length(p_parcel_ids, 1) is null then
    raise exception 'no_parcels';
  end if;
  if v_reason is null then
    raise exception 'reason_required';
  end if;

  select array_agg(distinct company_id) into v_companies
    from public.parcels
   where id = any (p_parcel_ids);
  if v_companies is null then
    raise exception 'parcel_not_found';
  end if;
  if array_length(v_companies, 1) <> 1 then
    raise exception 'mixed_companies';
  end if;
  v_company := v_companies[1];

  if not public.is_platform_admin()
     and not (
       v_company = public.current_company_id()
       and public.has_any_role('manager', 'parcel_manager')
     ) then
    raise exception 'not_authorized';
  end if;

  -- Kun åbne pakker: en afsluttet pakke (udleveret/returneret) er en sand
  -- hændelse, og en allerede fjernet pakke skal ikke fjernes igen.
  for v_parcel in
    select id, company_id, status, barcode
      from public.parcels
     where id = any (p_parcel_ids)
       and company_id = v_company
       and status not in ('delivered', 'returned', 'removed')
     order by registered_at
     for update
  loop
    update public.parcels
       set status = 'removed',
           removed_reason = v_reason,
           removed_by = auth.uid(),
           removed_at = now()
     where id = v_parcel.id;

    insert into public.parcel_events
      (parcel_id, company_id, event_type, from_status, to_status, actor_user_id, detail)
    values
      (v_parcel.id, v_parcel.company_id, 'removed', v_parcel.status, 'removed', auth.uid(),
       jsonb_build_object('barcode', v_parcel.barcode, 'reason', v_reason));

    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'no_removable_parcels';
  end if;

  return v_count;
end;
$$;

revoke execute on function public.remove_parcel(uuid[], text) from public, anon;
grant execute on function public.remove_parcel(uuid[], text) to authenticated;

-- ---------------------------------------------------------------------------
-- Logniveau: 'parcel.removed' er den hårdeste hændelse i pakkeflowet — en
-- registrering trækkes tilbage — og skal stå som fejl (rød) i Logs, ikke som en
-- advarsel på linje med en retur. Bemærk at det generelle '%.removed'-mønster
-- (advarsel) fortsat gælder alle andre entiteter; pakke-tilfældet står først.
-- audit_log.level er en genereret kolonne over denne funktion (kun nye rækker
-- beregnes om); klientspejlet er levelOf i web/src/routes/_app/operia.logs.tsx.
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
      or p_action like '%.overridden' or p_action like '%\_overridden' escape '\'
      or p_action like '%.complained' or p_action like '%\_complained' escape '\'
      or (p_action = 'parcel.status_changed'
          and coalesce(p_detail->>'to_status', '') in ('rejected', 'returned', 'removed'))
      then 'warning'
    else 'success'
  end
$$;
