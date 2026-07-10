-- Core tenancy: companies, app users, roles, platform admins + RLS helpers.
-- Tenant boundary is company_id on every tenant-owned table (see CLAUDE.md).

-- ---------------------------------------------------------------------------
-- Generic updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  registration_no text, -- CVR-nummer el.lign.
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger companies_set_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

-- DCA Logic-medarbejdere: super-tenant over alle kunder.
create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Én række pr. auth-bruger med systemadgang; binder brugeren til én tenant.
create table public.app_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  full_name text not null default '',
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index app_users_company_id_idx on public.app_users (company_id);

create trigger app_users_set_updated_at
  before update on public.app_users
  for each row execute function public.set_updated_at();

create type public.app_role as enum ('manager', 'parcel_handler', 'final_receiver');

create table public.user_roles (
  user_id uuid not null references public.app_users (user_id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- ---------------------------------------------------------------------------
-- RLS helpers (SECURITY DEFINER så de kan læse på tværs af RLS uden rekursion)
-- ---------------------------------------------------------------------------
create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id from public.app_users where user_id = (select auth.uid());
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.platform_admins where user_id = (select auth.uid())
  );
$$;

create or replace function public.has_role(r public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = (select auth.uid()) and role = r
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.companies enable row level security;
alter table public.platform_admins enable row level security;
alter table public.app_users enable row level security;
alter table public.user_roles enable row level security;

-- companies: egen virksomhed kan læses; kun platform-admin opretter/ændrer.
create policy companies_select on public.companies
  for select to authenticated
  using (id = public.current_company_id() or public.is_platform_admin());

create policy companies_insert on public.companies
  for insert to authenticated
  with check (public.is_platform_admin());

create policy companies_update on public.companies
  for update to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy companies_delete on public.companies
  for delete to authenticated
  using (public.is_platform_admin());

-- platform_admins: kun platform-admins kan se/ændre listen.
create policy platform_admins_all on public.platform_admins
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- app_users: alle i virksomheden kan se kolleger; managers administrerer.
create policy app_users_select on public.app_users
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

create policy app_users_insert on public.app_users
  for insert to authenticated
  with check (
    (company_id = public.current_company_id() and public.has_role('manager'))
    or public.is_platform_admin()
  );

create policy app_users_update on public.app_users
  for update to authenticated
  using (
    user_id = (select auth.uid())
    or (company_id = public.current_company_id() and public.has_role('manager'))
    or public.is_platform_admin()
  )
  with check (
    company_id = public.current_company_id() or public.is_platform_admin()
  );

create policy app_users_delete on public.app_users
  for delete to authenticated
  using (
    (company_id = public.current_company_id() and public.has_role('manager'))
    or public.is_platform_admin()
  );

-- user_roles: synlige i egen virksomhed; kun managers/platform-admin ændrer.
create policy user_roles_select on public.user_roles
  for select to authenticated
  using (
    exists (
      select 1 from public.app_users au
      where au.user_id = user_roles.user_id
        and (au.company_id = public.current_company_id() or public.is_platform_admin())
    )
  );

create policy user_roles_write on public.user_roles
  for all to authenticated
  using (
    public.is_platform_admin()
    or (
      public.has_role('manager')
      and exists (
        select 1 from public.app_users au
        where au.user_id = user_roles.user_id
          and au.company_id = public.current_company_id()
      )
    )
  )
  with check (
    public.is_platform_admin()
    or (
      public.has_role('manager')
      and exists (
        select 1 from public.app_users au
        where au.user_id = user_roles.user_id
          and au.company_id = public.current_company_id()
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Grants (RLS afgør rækkeadgang; grants åbner kun tabelniveauet)
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.companies, public.platform_admins,
  public.app_users, public.user_roles to authenticated;
