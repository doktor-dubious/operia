-- Booking: bookinger i fortiden ("retroaktiv booking") gøres til et
-- konfigurationsvalg pr. virksomhed.
--
-- Standard er TILLADT: efterregistrering er et reelt arbejdsmønster
-- ("puljebilen blev taget i går — læg den i kalenderen"), og en booking i
-- fortiden kan aldrig ødelægge noget (overlaps-værnet er tidsretnings-
-- ligegyldigt, og alt auditeres). Klienten viser en blød advarsel.
--
-- Slår kunden det FRA, håndhæves det her i RPC'erne — browseren er utroværdig,
-- så klientens skjulte knap er kun kosmetik. Reglen:
--   - heldags: bookingen skal række ind i nutiden (ends_at > now()) — en
--     heldagsbooking I DAG starter ved lokal midnat og må ikke afvises, og
--     dato-sammenligning på tværs af tidszoner er et minefelt; slut-tidspunktet
--     er entydigt.
--   - med klokkeslæt: starten må ikke ligge i fortiden (5 min kulance, så
--     "book fra nu af" ikke taber kapløbet med uret).
-- Redigering rammes kun når tidsrummet ÆNDRES — titel/medarbejder på en
-- igangværende eller afholdt booking kan altid rettes.

alter table public.companies
  add column booking_retro_allowed boolean not null default true;

alter table public.platform_settings
  add column booking_retro_allowed boolean not null default true;

-- Nye kunder arver begge booking-standarder fra platformen.
create or replace function public.companies_booking_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select p.booking_time_mode, p.booking_retro_allowed
    into new.booking_time_mode, new.booking_retro_allowed
  from public.platform_settings p
  where p.id;
  return new;
end;
$$;

-- Fælles regel (intern, ingen grants): fejler med booking_in_past når
-- virksomheden har slået retroaktiv booking fra og intervallet ligger i
-- fortiden efter reglerne ovenfor.
create or replace function public.assert_booking_not_retro(
  p_company_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_all_day boolean
) returns void
language plpgsql stable security definer set search_path = public as $$
declare
  v_allowed boolean;
begin
  select booking_retro_allowed into v_allowed
  from public.companies where id = p_company_id;
  if coalesce(v_allowed, true) then
    return;
  end if;
  if coalesce(p_all_day, false) then
    if p_ends_at <= now() then
      raise exception 'booking_in_past' using errcode = 'P0001';
    end if;
  elsif p_starts_at < now() - interval '5 minutes' then
    raise exception 'booking_in_past' using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function public.assert_booking_not_retro(uuid, timestamptz, timestamptz, boolean)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- create_booking / update_booking: uændrede fra 20260829090100 bortset fra
-- retro-tjekket (efter intervalvalideringen).
-- ---------------------------------------------------------------------------
create or replace function public.create_booking(
  p_resource_id uuid,
  p_employee_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_title text default null,
  p_all_day boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_resource public.booking_resources;
  v_employee public.employees;
  v_id uuid;
begin
  select * into v_resource from public.booking_resources where id = p_resource_id;
  if not found then
    raise exception 'booking_resource_not_found' using errcode = 'P0002';
  end if;
  if not public.can_operate_bookings(v_resource.company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not v_resource.is_active then
    raise exception 'booking_resource_inactive' using errcode = 'P0001';
  end if;

  select * into v_employee from public.employees
    where id = p_employee_id and company_id = v_resource.company_id;
  if not found then
    raise exception 'employee_not_found' using errcode = 'P0002';
  end if;
  if not v_employee.is_active then
    raise exception 'employee_inactive' using errcode = 'P0001';
  end if;

  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'booking_invalid_interval' using errcode = 'P0001';
  end if;

  perform public.assert_booking_not_retro(
    v_resource.company_id, p_starts_at, p_ends_at, p_all_day);

  begin
    insert into public.bookings
      (company_id, resource_id, employee_id, booked_by, starts_at, ends_at, all_day, title)
    values
      (v_resource.company_id, v_resource.id, v_employee.id, auth.uid(),
       p_starts_at, p_ends_at, coalesce(p_all_day, false), nullif(btrim(coalesce(p_title, '')), ''))
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'booking_overlap' using errcode = 'P0001';
  end;

  insert into public.booking_events
    (booking_id, company_id, event_type, actor_user_id, detail)
  values
    (v_id, v_resource.company_id, 'created', auth.uid(),
     jsonb_build_object(
       'resource_id', v_resource.id,
       'employee_id', v_employee.id,
       'starts_at', p_starts_at,
       'ends_at', p_ends_at,
       'all_day', coalesce(p_all_day, false)));

  return v_id;
end;
$$;

create or replace function public.update_booking(
  p_booking_id uuid,
  p_resource_id uuid,
  p_employee_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_title text default null,
  p_all_day boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_booking public.bookings;
  v_resource public.booking_resources;
  v_employee public.employees;
begin
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  if not public.can_operate_bookings(v_booking.company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_booking.status <> 'booked' then
    raise exception 'booking_not_editable' using errcode = 'P0001';
  end if;

  select * into v_resource from public.booking_resources
    where id = p_resource_id and company_id = v_booking.company_id;
  if not found then
    raise exception 'booking_resource_not_found' using errcode = 'P0002';
  end if;
  -- En deaktiveret ressource må beholde sine bookinger, men ikke få nye tider:
  -- kun hvis ressourcen er uændret OG tiden er uændret slipper den igennem.
  if not v_resource.is_active
     and (v_resource.id <> v_booking.resource_id
          or p_starts_at is distinct from v_booking.starts_at
          or p_ends_at is distinct from v_booking.ends_at) then
    raise exception 'booking_resource_inactive' using errcode = 'P0001';
  end if;

  select * into v_employee from public.employees
    where id = p_employee_id and company_id = v_booking.company_id;
  if not found then
    raise exception 'employee_not_found' using errcode = 'P0002';
  end if;
  if not v_employee.is_active and v_employee.id <> v_booking.employee_id then
    raise exception 'employee_inactive' using errcode = 'P0001';
  end if;

  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'booking_invalid_interval' using errcode = 'P0001';
  end if;

  -- Retro-reglen rammer kun når tidsrummet ændres — titel/medarbejder på en
  -- igangværende eller afholdt booking kan altid rettes.
  if p_starts_at is distinct from v_booking.starts_at
     or p_ends_at is distinct from v_booking.ends_at then
    perform public.assert_booking_not_retro(
      v_booking.company_id, p_starts_at, p_ends_at, p_all_day);
  end if;

  begin
    update public.bookings
       set resource_id = v_resource.id,
           employee_id = v_employee.id,
           starts_at = p_starts_at,
           ends_at = p_ends_at,
           all_day = coalesce(p_all_day, false),
           title = nullif(btrim(coalesce(p_title, '')), '')
     where id = v_booking.id;
  exception when exclusion_violation then
    raise exception 'booking_overlap' using errcode = 'P0001';
  end;

  insert into public.booking_events
    (booking_id, company_id, event_type, actor_user_id, detail)
  values
    (v_booking.id, v_booking.company_id, 'updated', auth.uid(),
     jsonb_build_object(
       'from_resource_id', v_booking.resource_id,
       'to_resource_id', v_resource.id,
       'from_employee_id', v_booking.employee_id,
       'to_employee_id', v_employee.id,
       'from_starts_at', v_booking.starts_at,
       'to_starts_at', p_starts_at,
       'from_ends_at', v_booking.ends_at,
       'to_ends_at', p_ends_at));
end;
$$;
