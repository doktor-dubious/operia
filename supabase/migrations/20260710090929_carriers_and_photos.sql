-- Fragtfirmaer (pr. virksomhed, som øvrig stamdata) + kobling på pakker,
-- samt privat storage-bucket til tilstandsfotos (chain-of-custody-bevis).

create table public.carriers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);

create index carriers_company_id_idx on public.carriers (company_id);

create trigger carriers_set_updated_at
  before update on public.carriers
  for each row execute function public.set_updated_at();

alter table public.parcels
  add column carrier_id uuid references public.carriers (id) on delete set null;

-- Guard-funktionen udvides med tenant-validering af fragtfirma.
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
  if new.carrier_id is not null and not exists (
    select 1 from public.carriers c
    where c.id = new.carrier_id and c.company_id = new.company_id
  ) then
    raise exception 'Fragtfirma tilhører ikke virksomheden';
  end if;

  return new;
end;
$$;

alter table public.carriers enable row level security;

create policy carriers_select on public.carriers
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

create policy carriers_write on public.carriers
  for all to authenticated
  using (
    (company_id = public.current_company_id() and public.has_role('manager'))
    or public.is_platform_admin()
  )
  with check (
    (company_id = public.current_company_id() and public.has_role('manager'))
    or public.is_platform_admin()
  );

grant select, insert, update, delete on public.carriers to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: privat bucket til tilstandsfotos. Sti-konvention:
--   <company_id>/<parcel_id>.<ext>  — RLS binder mappen til brugerens tenant.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('parcel-photos', 'parcel-photos', false)
on conflict (id) do nothing;

create policy parcel_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'parcel-photos'
    and (
      (storage.foldername(name))[1] = public.current_company_id()::text
      or public.is_platform_admin()
    )
  );

create policy parcel_photos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'parcel-photos'
    and (
      (storage.foldername(name))[1] = public.current_company_id()::text
      or public.is_platform_admin()
    )
  );
