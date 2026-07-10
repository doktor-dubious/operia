-- Flow 0 (pilot): grundlag for medarbejderimport via CSV.
--  - employees.is_manual: manuelt oprettede medarbejdere røres aldrig af importen
--  - unik nøgle pr. virksomhed på medarbejder-nr. (importens upsert-nøgle)
--  - import_runs: log over kørsler = Manager-alarmfladen fra spec'en

alter table public.employees
  add column is_manual boolean not null default false;

-- Partielt unikt indeks: manuelt oprettede kan mangle medarbejder-nr.
create unique index employees_company_employee_no_key
  on public.employees (company_id, employee_no)
  where employee_no is not null;

create table public.import_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  kind text not null default 'employees_csv',
  file_name text,
  status text not null check (status in ('applied', 'rejected', 'failed')),
  rows_total int not null default 0,
  created_count int not null default 0,
  updated_count int not null default 0,
  unchanged_count int not null default 0,
  deactivated_count int not null default 0,
  skipped_manual_count int not null default 0,
  departments_created int not null default 0,
  rejected_count int not null default 0,
  errors jsonb not null default '[]'::jsonb, -- [{row, reason}]
  created_by uuid references auth.users (id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now()
);

create index import_runs_company_idx on public.import_runs (company_id, created_at desc);

alter table public.import_runs enable row level security;

-- Loggen er append-only: læs + indsæt for managers/platform-admins; aldrig
-- opdatering/sletning (den er alarm- og revisionsflade).
create policy import_runs_select on public.import_runs
  for select to authenticated
  using (
    (company_id = public.current_company_id() and public.has_role('manager'))
    or public.is_platform_admin()
  );

create policy import_runs_insert on public.import_runs
  for insert to authenticated
  with check (
    (company_id = public.current_company_id() and public.has_role('manager'))
    or public.is_platform_admin()
  );

grant select, insert on public.import_runs to authenticated;
