-- Skabe (smart lockers) — stamdata for locker-produktet. I prototypen var
-- location fritekst; her er det en rigtig FK til storage_locations (samme
-- placeringsbegreb som pakker). keynius_bank_id er leverandørens (Keynius)
-- ID for den fysiske locker-væg i deres SmartHub-API.

create table public.lockers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  keynius_bank_id text,
  storage_location_id uuid references public.storage_locations (id) on delete set null,
  cap_small int not null default 0 check (cap_small >= 0),
  cap_medium int not null default 0 check (cap_medium >= 0),
  cap_large int not null default 0 check (cap_large >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);

create index lockers_company_id_idx on public.lockers (company_id);

create trigger lockers_set_updated_at
  before update on public.lockers
  for each row execute function public.set_updated_at();

alter table public.lockers enable row level security;

create policy lockers_select on public.lockers
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

create policy lockers_write on public.lockers
  for all to authenticated
  using (
    (company_id = public.current_company_id() and public.has_role('manager'))
    or public.is_platform_admin()
  )
  with check (
    (company_id = public.current_company_id() and public.has_role('manager'))
    or public.is_platform_admin()
  );

grant select, insert, update, delete on public.lockers to authenticated;
