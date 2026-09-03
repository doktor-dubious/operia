-- Booking-produktet, del 1: kernen.
--
-- Booking af ressourcer af enhver art (mødelokaler, biler, udstyr) til
-- FREMTIDIGE tidsintervaller, med medarbejdere fra kartoteket som modpart.
-- Arkitekturen følger Aktiver (register + append-only hændelseslog + flow-
-- RPC'er), men kernen er ny: en booking er et interval, og dobbeltbooking
-- forhindres i databasen med en exclusion constraint (btree_gist) — klienten
-- kan aldrig "vinde" et kapløb om samme tidsrum.
--
-- Bevidst udeladt i v1 (kommer senere): fakturering (feature-nøgle under
-- 'booking'), medarbejder-selvbetjening, gentagne bookinger, godkendelsesflow,
-- håndterminal, kalender-synk (Outlook/Entra), påmindelser.
--
-- Tidsgranularitet: pr. virksomhed (companies.booking_time_mode, 'timed' |
-- 'day') med mulighed for at overstyre pr. ressource (time_mode, NULL = arv).

-- ---------------------------------------------------------------------------
-- btree_gist: gør '=' på uuid brugbar i en gist-exclusion sammen med
-- range-overlap (&&). Første brug i kodebasen.
-- ---------------------------------------------------------------------------
create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- Produktkataloget: 'Lokalebooking' hed produktet da det kun var mødelokaler.
-- Nu dækker det alle ressourcetyper — nøglen 'booking' er uændret (refereres
-- af nav/home-tiles/product-texts og entitlements).
-- ---------------------------------------------------------------------------
update public.product_catalog
   set name = 'Booking',
       description = 'Booking af lokaler, køretøjer og udstyr',
       name_en = 'Booking',
       description_en = 'Booking of rooms, vehicles and equipment'
 where key = 'booking';

-- ---------------------------------------------------------------------------
-- Rettighedsgrænser (som can_write_assets/can_operate_assets):
--   manage  — stamdata + indstillinger: manager/booking_manager
--   operate — selve bookingflowet: også booking_handler
-- ---------------------------------------------------------------------------
create or replace function public.can_manage_bookings(p_company_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (
    p_company_id = public.current_company_id()
    and public.has_any_role('manager', 'booking_manager')
  )
  or public.is_platform_admin()
$$;

revoke execute on function public.can_manage_bookings(uuid) from public, anon;
grant execute on function public.can_manage_bookings(uuid) to authenticated;

create or replace function public.can_operate_bookings(p_company_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (
    p_company_id = public.current_company_id()
    and public.has_any_role('manager', 'booking_manager', 'booking_handler')
  )
  or public.is_platform_admin()
$$;

revoke execute on function public.can_operate_bookings(uuid) from public, anon;
grant execute on function public.can_operate_bookings(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Tidsgranularitet: virksomhedens standard + platformens arvegrundlag
-- ---------------------------------------------------------------------------
alter table public.companies
  add column booking_time_mode text not null default 'timed';
alter table public.companies
  add constraint companies_booking_time_mode_check
    check (booking_time_mode in ('timed', 'day'));

alter table public.platform_settings
  add column booking_time_mode text not null default 'timed';
alter table public.platform_settings
  add constraint platform_settings_booking_time_mode_check
    check (booking_time_mode in ('timed', 'day'));

-- Nye kunder arver platformens standard (kolonne-defaults kan ikke slå op i en
-- anden tabel — samme mønster som companies_asset_no_defaults).
create or replace function public.companies_booking_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select p.booking_time_mode
    into new.booking_time_mode
  from public.platform_settings p
  where p.id;
  return new;
end;
$$;

create trigger companies_booking_defaults
  before insert on public.companies
  for each row execute function public.companies_booking_defaults();

-- ---------------------------------------------------------------------------
-- Stamdata: kategorier og ressourcer
-- ---------------------------------------------------------------------------
create table public.booking_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

create table public.booking_resources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  category_id uuid references public.booking_categories (id) on delete set null,
  -- Fritekst i v1 — rum/bygning/parkering; ingen stamdata-tabel endnu.
  location text,
  capacity int check (capacity is null or capacity > 0),
  -- Valgfrit link til aktivregisteret (en puljebil er også et aktiv).
  -- Krydsregler (udlån blokerer booking m.v.) er bevidst udskudt.
  asset_id uuid references public.assets (id) on delete set null,
  -- NULL = arv virksomhedens booking_time_mode.
  time_mode text check (time_mode is null or time_mode in ('timed', 'day')),
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

alter table public.booking_categories enable row level security;
alter table public.booking_resources enable row level security;

create policy booking_categories_select on public.booking_categories
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());
create policy booking_categories_write on public.booking_categories
  for all to authenticated
  using (public.can_manage_bookings(company_id))
  with check (public.can_manage_bookings(company_id));

create policy booking_resources_select on public.booking_resources
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());
create policy booking_resources_write on public.booking_resources
  for all to authenticated
  using (public.can_manage_bookings(company_id))
  with check (public.can_manage_bookings(company_id));

grant select, insert, update, delete
  on public.booking_categories, public.booking_resources to authenticated;

-- Tenant-guard: FK-opslag omgår RLS, så tilhørsforhold valideres eksplicit.
create or replace function public.booking_resources_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.category_id is not null and not exists (
    select 1 from public.booking_categories c
    where c.id = new.category_id and c.company_id = new.company_id
  ) then
    raise exception 'Kategorien tilhører ikke virksomheden';
  end if;
  if new.asset_id is not null and not exists (
    select 1 from public.assets a
    where a.id = new.asset_id and a.company_id = new.company_id
  ) then
    raise exception 'Aktivet tilhører ikke virksomheden';
  end if;
  return new;
end;
$$;

create trigger booking_resources_guard
  before insert or update on public.booking_resources
  for each row execute function public.booking_resources_guard();

-- Revisionslog som de øvrige stamdata-registre.
create or replace function public.audit_booking_categories()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit(new.company_id, 'booking_category.created', 'booking_category',
      new.id::text, new.name);
    return new;
  elsif tg_op = 'UPDATE' then
    if old.is_active and not new.is_active then
      perform public.record_audit(new.company_id, 'booking_category.deactivated', 'booking_category',
        new.id::text, new.name);
    end if;
    return new;
  else
    perform public.record_audit(old.company_id, 'booking_category.deleted', 'booking_category',
      old.id::text, old.name);
    return old;
  end if;
end;
$$;

create trigger audit_booking_categories_trg
  after insert or update or delete on public.booking_categories
  for each row execute function public.audit_booking_categories();

create or replace function public.audit_booking_resources()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit(new.company_id, 'booking_resource.created', 'booking_resource',
      new.id::text, new.name);
    return new;
  elsif tg_op = 'UPDATE' then
    if old.is_active and not new.is_active then
      perform public.record_audit(new.company_id, 'booking_resource.deactivated', 'booking_resource',
        new.id::text, new.name);
    end if;
    return new;
  else
    perform public.record_audit(old.company_id, 'booking_resource.deleted', 'booking_resource',
      old.id::text, old.name);
    return old;
  end if;
end;
$$;

create trigger audit_booking_resources_trg
  after insert or update or delete on public.booking_resources
  for each row execute function public.audit_booking_resources();

-- ---------------------------------------------------------------------------
-- Bookinger. Skrives KUN via RPC'erne nedenfor (ingen skrivepolitik, som
-- asset_loans) — browseren er utroværdig.
-- ---------------------------------------------------------------------------
create type public.booking_status as enum ('booked', 'cancelled');

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  resource_id uuid not null references public.booking_resources (id) on delete restrict,
  -- GDPR: kun FK-referencen — navnet bor i employees-rækken, og anonymisering
  -- af den ER sletningen (som assets.assigned_to_employee_id). Nullable fordi
  -- platform-admin-sletning af testmedarbejdere sætter den til null;
  -- RPC'erne kræver altid en medarbejder ved oprettelse.
  employee_id uuid references public.employees (id) on delete set null,
  booked_by uuid references auth.users (id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  -- Kort formål ("Teammøde", "Kundebesøg") — fritekst, registreret i
  -- docs/gdpr/free-text-fields.md og søgbar i indsigtsudtrækket.
  title text,
  status public.booking_status not null default 'booked',
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint bookings_interval_check check (ends_at > starts_at),
  constraint bookings_title_sane
    check (title is null or (char_length(title) <= 200 and title !~ '[[:cntrl:]]')),
  -- Kernen: to aktive bookinger på samme ressource kan aldrig overlappe.
  -- Halvåbne intervaller '[)': kl. 10-11 og 11-12 støder op uden konflikt.
  constraint bookings_no_overlap exclude using gist (
    resource_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status = 'booked')
);

create index bookings_company_starts_idx on public.bookings (company_id, starts_at);
create index bookings_resource_starts_idx on public.bookings (resource_id, starts_at);
create index bookings_employee_idx on public.bookings (employee_id);

alter table public.bookings enable row level security;

create policy bookings_select on public.bookings
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

grant select on public.bookings to authenticated;

-- Tenant-guard (belt & braces — RPC'erne validerer også selv).
create or replace function public.bookings_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.booking_resources r
    where r.id = new.resource_id and r.company_id = new.company_id
  ) then
    raise exception 'Ressourcen tilhører ikke virksomheden';
  end if;
  if new.employee_id is not null and not exists (
    select 1 from public.employees e
    where e.id = new.employee_id and e.company_id = new.company_id
  ) then
    raise exception 'Medarbejderen tilhører ikke virksomheden';
  end if;
  return new;
end;
$$;

create trigger bookings_guard
  before insert or update on public.bookings
  for each row execute function public.bookings_guard();

-- ---------------------------------------------------------------------------
-- Hændelsesloggen: append-only som asset_events. Ingen persondata i detail —
-- kun id-referencer og tidspunkter (loggen kan aldrig renses).
-- Hændelsestyper: created | updated | cancelled.
-- ---------------------------------------------------------------------------
create table public.booking_events (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.bookings (id) on delete restrict,
  company_id uuid not null references public.companies (id) on delete restrict,
  event_type text not null,
  actor_user_id uuid, -- bevidst uden FK: loggen må aldrig ændres, heller ikke af cascades
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index booking_events_booking_idx on public.booking_events (booking_id, created_at);
create index booking_events_company_idx on public.booking_events (company_id, created_at);

revoke update, delete on public.booking_events from anon, authenticated;

-- Som parcel_events/asset_events BEVIDST undtaget retention-purge som serie —
-- hændelserne følger bookingens levetid og slettes kun sammen med den.
create trigger booking_events_immutable
  before update or delete on public.booking_events
  for each row execute function public.block_mutation();

alter table public.booking_events enable row level security;

create policy booking_events_select on public.booking_events
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

grant select on public.booking_events to authenticated;

-- Spejl til audit_log (som audit_asset_events): minimeret detail.
create or replace function public.audit_booking_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.record_audit(
    new.company_id,
    'booking.' || new.event_type,
    'booking',
    new.booking_id::text,
    null,
    new.detail,
    new.actor_user_id
  );
  return new;
end;
$$;

create trigger audit_booking_events_trg
  after insert on public.booking_events
  for each row execute function public.audit_booking_events();

-- ---------------------------------------------------------------------------
-- Flow-RPC'er. SECURITY DEFINER: rettigheder gentjekkes server-side, og
-- overlap-fejlen fra exclusion-constrainten oversættes til en maskinlæsbar
-- kode klienten kan vise pænt (bookingFlow.errBookingOverlap).
-- Fejlstil som aktiv-flowet: snake_case-koder med errcode
-- P0002 = findes ikke, 42501 = ingen adgang, P0001 = forretningsregel.
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

revoke execute on function public.create_booking(uuid, uuid, timestamptz, timestamptz, text, boolean) from public, anon;
grant execute on function public.create_booking(uuid, uuid, timestamptz, timestamptz, text, boolean) to authenticated;

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

revoke execute on function public.update_booking(uuid, uuid, uuid, timestamptz, timestamptz, text, boolean) from public, anon;
grant execute on function public.update_booking(uuid, uuid, uuid, timestamptz, timestamptz, text, boolean) to authenticated;

create or replace function public.cancel_booking(
  p_booking_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_booking public.bookings;
begin
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  if not public.can_operate_bookings(v_booking.company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_booking.status <> 'booked' then
    raise exception 'booking_already_cancelled' using errcode = 'P0001';
  end if;

  update public.bookings
     set status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = auth.uid()
   where id = v_booking.id;

  insert into public.booking_events
    (booking_id, company_id, event_type, actor_user_id, detail)
  values
    (v_booking.id, v_booking.company_id, 'cancelled', auth.uid(),
     jsonb_build_object(
       'resource_id', v_booking.resource_id,
       'starts_at', v_booking.starts_at,
       'ends_at', v_booking.ends_at));
end;
$$;

revoke execute on function public.cancel_booking(uuid) from public, anon;
grant execute on function public.cancel_booking(uuid) to authenticated;
