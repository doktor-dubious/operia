-- Ruter (ruteplanlægnings-produktet) — tenant-ejet stamdata, samme mønster som
-- storage_locations/lockers. Fra/til/stop gemmes med adresse + valgfri
-- koordinater; geometry/distance/duration udfyldes når ruten beregnes (senere
-- trin) via den valgte udbyder på Operia → Kort & ruter. transport_type styrer
-- ruteprofilen; num_cars/drivers er beskrivende metadata indtil videre.
create table public.routes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  description text,
  notes text,
  from_address text,
  from_lat double precision,
  from_lng double precision,
  to_address text,
  to_lat double precision,
  to_lng double precision,
  stops jsonb not null default '[]'::jsonb,          -- [{ address, lat?, lng? }]
  round_trip boolean not null default false,
  optimize_stops boolean not null default false,
  transport_type text not null default 'car' check (transport_type in ('car', 'bike', 'walk')),
  num_cars integer not null default 1 check (num_cars >= 1),
  drivers jsonb not null default '[]'::jsonb,         -- ["name", ...] pr. bil
  geometry jsonb,                                     -- beregnet GeoJSON (senere)
  distance_m double precision,
  duration_s double precision,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);

create index routes_company_id_idx on public.routes (company_id);

create trigger routes_set_updated_at
  before update on public.routes
  for each row execute function public.set_updated_at();

alter table public.routes enable row level security;

create policy routes_select on public.routes
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

create policy routes_write on public.routes
  for all to authenticated
  using ((company_id = public.current_company_id() and public.has_role('manager')) or public.is_platform_admin())
  with check ((company_id = public.current_company_id() and public.has_role('manager')) or public.is_platform_admin());

grant select, insert, update, delete on public.routes to authenticated;

-- Audit (NIS2): oprettelse/deaktivering/sletning af ruter.
create or replace function public.audit_routes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit(new.company_id, 'route.created', 'route', new.id::text, new.name);
    return new;
  elsif tg_op = 'UPDATE' then
    if old.is_active and not new.is_active then
      perform public.record_audit(new.company_id, 'route.deactivated', 'route', new.id::text, new.name);
    end if;
    return new;
  else
    perform public.record_audit(old.company_id, 'route.deleted', 'route', old.id::text, old.name);
    return old;
  end if;
end;
$$;

create trigger audit_routes_trg
  after insert or update or delete on public.routes
  for each row execute function public.audit_routes();

-- Udvid Logs-kategoriseringen så 'route.*' også havner under 'maps' (Kort & ruter).
create or replace function public.audit_category(p_action text)
returns text language sql immutable as $$
  select case split_part(coalesce(p_action, ''), '.', 1)
    when 'parcel'         then 'parcels'
    when 'parcel_flow'    then 'parcels'
    when 'employee'       then 'directory'
    when 'department'     then 'directory'
    when 'location'       then 'config'
    when 'handling_class' then 'config'
    when 'carrier'        then 'config'
    when 'shipping'       then 'shipping'
    when 'agreement'      then 'shipping'
    when 'asset'          then 'assets'
    when 'asset_category' then 'assets'
    when 'asset_location' then 'assets'
    when 'assets'         then 'assets'
    when 'inventory_item' then 'inventory'
    when 'locker'         then 'lockers'
    when 'user'           then 'access'
    when 'product'        then 'entitlements'
    when 'feature'        then 'entitlements'
    when 'template'       then 'branding'
    when 'language'       then 'branding'
    when 'currency'       then 'branding'
    when 'maps'           then 'maps'
    when 'route'          then 'maps'
    when 'import'         then 'imports'
    when 'import_config'  then 'imports'
    else 'other'
  end
$$;
