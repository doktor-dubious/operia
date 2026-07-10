-- Employee directory: departments + employees (Flow 0 imports lander her).
-- Alle importerede medarbejdere er modtagere som udgangspunkt — uden systemadgang.
-- Systemadgang = kobling til auth-bruger via employees.user_id / app_users.

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);

create index departments_company_id_idx on public.departments (company_id);

create trigger departments_set_updated_at
  before update on public.departments
  for each row execute function public.set_updated_at();

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  department_id uuid references public.departments (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null, -- sat når medarbejderen får login
  employee_no text,
  initials text,
  full_name text not null,
  email text,
  phone text,
  language text not null default 'da',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index employees_company_id_idx on public.employees (company_id);
-- Autocomplete ved intake slår op på navn/initialer inden for virksomheden.
create index employees_company_name_idx on public.employees (company_id, full_name);
create index employees_company_initials_idx on public.employees (company_id, initials);

create trigger employees_set_updated_at
  before update on public.employees
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: læsning for alle i virksomheden (handlers skal kunne søge modtagere);
-- skrivning for managers (og platform-admins).
-- ---------------------------------------------------------------------------
alter table public.departments enable row level security;
alter table public.employees enable row level security;

create policy departments_select on public.departments
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

create policy departments_write on public.departments
  for all to authenticated
  using (
    (company_id = public.current_company_id() and public.has_role('manager'))
    or public.is_platform_admin()
  )
  with check (
    (company_id = public.current_company_id() and public.has_role('manager'))
    or public.is_platform_admin()
  );

create policy employees_select on public.employees
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

create policy employees_write on public.employees
  for all to authenticated
  using (
    (company_id = public.current_company_id() and public.has_role('manager'))
    or public.is_platform_admin()
  )
  with check (
    (company_id = public.current_company_id() and public.has_role('manager'))
    or public.is_platform_admin()
  );

grant select, insert, update, delete on public.departments, public.employees to authenticated;
