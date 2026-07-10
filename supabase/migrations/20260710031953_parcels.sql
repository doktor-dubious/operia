-- Parcels: kerneproduktet. Lagerplaceringer, håndteringsklasser, pakker med
-- status-state-machine og append-only, immutabel hændelseslog (parcel_events).

create type public.parcel_status as enum (
  'unassigned',  -- modtager ikke matchet ved intake
  'registered',  -- modtaget og matchet
  'in_storage',
  'in_transit',
  'in_locker',
  'delivered',
  'rejected',
  'returned'
);

create type public.parcel_type as enum ('package', 'pallet', 'letter');

create table public.storage_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  barcode text, -- placeringer kan have stregkode (scan) eller ej (vælg fra liste)
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);

create index storage_locations_company_id_idx on public.storage_locations (company_id);

create trigger storage_locations_set_updated_at
  before update on public.storage_locations
  for each row execute function public.set_updated_at();

-- Håndteringsklassifikation styrer hvad der er tilladt ved udlevering.
create table public.handling_classes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  allow_proxy_collection boolean not null default false,
  allow_leave_at_location boolean not null default false,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);

create trigger handling_classes_set_updated_at
  before update on public.handling_classes
  for each row execute function public.set_updated_at();

create table public.parcels (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  barcode text,
  status public.parcel_status not null default 'registered',
  parcel_type public.parcel_type not null default 'package',
  is_private boolean not null default false, -- privat vs. firmapakke
  receiver_employee_id uuid references public.employees (id) on delete set null,
  department_id uuid references public.departments (id) on delete set null,
  sender text,
  handling_class_id uuid references public.handling_classes (id) on delete set null,
  storage_location_id uuid references public.storage_locations (id) on delete set null,
  condition_preset text,
  condition_note text,
  condition_photo_path text, -- storage: <company_id>/<parcel_id>.<ext>
  registered_by uuid references auth.users (id) on delete set null,
  registered_at timestamptz not null default now(),
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index parcels_company_status_idx on public.parcels (company_id, status);
create index parcels_company_barcode_idx on public.parcels (company_id, barcode);
create index parcels_receiver_idx on public.parcels (receiver_employee_id);

create trigger parcels_set_updated_at
  before update on public.parcels
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Append-only hændelseslog. Immutabel: UPDATE/DELETE er både revoked og
-- trigger-blokeret; rækker skrives kun af SECURITY DEFINER-triggere.
-- ---------------------------------------------------------------------------
create table public.parcel_events (
  id bigint generated always as identity primary key,
  parcel_id uuid not null references public.parcels (id) on delete restrict,
  company_id uuid not null references public.companies (id) on delete restrict,
  event_type text not null, -- created | status_changed | moved | receiver_assigned | updated
  from_status public.parcel_status,
  to_status public.parcel_status,
  from_location_id uuid, -- bevidst uden FK: loggen må aldrig ændres, heller ikke af cascades
  to_location_id uuid,
  actor_user_id uuid, -- auth.uid() for den der udførte handlingen
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index parcel_events_parcel_idx on public.parcel_events (parcel_id, created_at);
create index parcel_events_company_idx on public.parcel_events (company_id, created_at);

revoke update, delete on public.parcel_events from anon, authenticated;

create or replace function public.block_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'parcel_events er append-only (% ikke tilladt)', tg_op;
end;
$$;

create trigger parcel_events_immutable
  before update or delete on public.parcel_events
  for each row execute function public.block_mutation();

-- ---------------------------------------------------------------------------
-- Status-state-machine
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
    when 'unassigned' then to_s in ('registered', 'in_storage', 'returned')
    when 'registered' then to_s in ('in_storage', 'in_transit', 'in_locker', 'delivered', 'rejected')
    when 'in_storage' then to_s in ('in_transit', 'in_locker', 'delivered', 'rejected', 'returned')
    when 'in_transit' then to_s in ('in_storage', 'in_locker', 'delivered', 'rejected', 'returned')
    when 'in_locker'  then to_s in ('delivered', 'returned', 'in_storage')
    when 'rejected'   then to_s in ('returned', 'in_storage')
    else false -- delivered og returned er terminale
  end;
$$;

create or replace function public.parcels_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    -- Uden matchet modtager starter pakken som 'unassigned' (spec Flow 1).
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
  end if;

  -- FK-opslag omgår RLS, så tenant-tilhør valideres eksplicit her.
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

  return new;
end;
$$;

create trigger parcels_guard
  before insert or update on public.parcels
  for each row execute function public.parcels_guard();

-- ---------------------------------------------------------------------------
-- Hændelseslogning (SECURITY DEFINER: skriver uden om RLS/revokes)
-- ---------------------------------------------------------------------------
create or replace function public.log_parcel_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.parcel_events
      (parcel_id, company_id, event_type, to_status, to_location_id, actor_user_id, detail)
    values
      (new.id, new.company_id, 'created', new.status, new.storage_location_id, auth.uid(),
       jsonb_build_object('barcode', new.barcode));
  else
    if new.status is distinct from old.status then
      insert into public.parcel_events
        (parcel_id, company_id, event_type, from_status, to_status,
         from_location_id, to_location_id, actor_user_id)
      values
        (new.id, new.company_id, 'status_changed', old.status, new.status,
         old.storage_location_id, new.storage_location_id, auth.uid());
    end if;
    if new.storage_location_id is distinct from old.storage_location_id then
      insert into public.parcel_events
        (parcel_id, company_id, event_type, from_status, to_status,
         from_location_id, to_location_id, actor_user_id)
      values
        (new.id, new.company_id, 'moved', old.status, new.status,
         old.storage_location_id, new.storage_location_id, auth.uid());
    end if;
    if new.receiver_employee_id is distinct from old.receiver_employee_id then
      insert into public.parcel_events
        (parcel_id, company_id, event_type, from_status, to_status, actor_user_id, detail)
      values
        (new.id, new.company_id, 'receiver_assigned', old.status, new.status, auth.uid(),
         jsonb_build_object(
           'from_receiver', old.receiver_employee_id,
           'to_receiver', new.receiver_employee_id
         ));
    end if;
  end if;
  return null;
end;
$$;

create trigger parcels_log_event
  after insert or update on public.parcels
  for each row execute function public.log_parcel_event();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.storage_locations enable row level security;
alter table public.handling_classes enable row level security;
alter table public.parcels enable row level security;
alter table public.parcel_events enable row level security;

create policy storage_locations_select on public.storage_locations
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

create policy storage_locations_write on public.storage_locations
  for all to authenticated
  using (
    (company_id = public.current_company_id() and public.has_role('manager'))
    or public.is_platform_admin()
  )
  with check (
    (company_id = public.current_company_id() and public.has_role('manager'))
    or public.is_platform_admin()
  );

create policy handling_classes_select on public.handling_classes
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

create policy handling_classes_write on public.handling_classes
  for all to authenticated
  using (
    (company_id = public.current_company_id() and public.has_role('manager'))
    or public.is_platform_admin()
  )
  with check (
    (company_id = public.current_company_id() and public.has_role('manager'))
    or public.is_platform_admin()
  );

-- parcels: handlers og managers arbejder med pakker; ingen hard delete fra klienter.
create policy parcels_select on public.parcels
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

create policy parcels_insert on public.parcels
  for insert to authenticated
  with check (
    (
      company_id = public.current_company_id()
      and (public.has_role('parcel_handler') or public.has_role('manager'))
    )
    or public.is_platform_admin()
  );

create policy parcels_update on public.parcels
  for update to authenticated
  using (
    (
      company_id = public.current_company_id()
      and (public.has_role('parcel_handler') or public.has_role('manager'))
    )
    or public.is_platform_admin()
  )
  with check (
    company_id = public.current_company_id() or public.is_platform_admin()
  );

-- parcel_events: læses i egen virksomhed; skrives KUN via triggere.
create policy parcel_events_select on public.parcel_events
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

-- Grants: bemærk parcel_events får KUN select — append-only håndhæves også her.
grant select, insert, update, delete on public.storage_locations, public.handling_classes to authenticated;
grant select, insert, update on public.parcels to authenticated; -- ingen delete fra klienter
grant select on public.parcel_events to authenticated;
