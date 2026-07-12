-- Virksomhedens egne skabelon-overrides (Konfigurér → Skabeloner):
-- platform_templates er DCA's standard; en virksomhed kan gemme sin egen
-- udgave pr. (key, lang) her, som så vinder over platformens.
create table public.company_templates (
  company_id uuid not null references public.companies (id) on delete cascade,
  key text not null,
  lang text not null default '*',
  kind text not null default 'text' check (kind in ('text', 'label')),
  title text not null default '',
  body text not null default '',
  updated_at timestamptz not null default now(),
  primary key (company_id, key, lang)
);

create trigger company_templates_set_updated_at
  before update on public.company_templates
  for each row execute function public.set_updated_at();

alter table public.company_templates enable row level security;

-- Egen virksomhed kan læses; managers redigerer egne skabeloner;
-- platform-admins alt.
create policy company_templates_select on public.company_templates
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

create policy company_templates_write on public.company_templates
  for all to authenticated
  using (
    (company_id = public.current_company_id() and public.has_role('manager'))
    or public.is_platform_admin()
  )
  with check (
    (company_id = public.current_company_id() and public.has_role('manager'))
    or public.is_platform_admin()
  );

grant select, insert, update, delete on public.company_templates to authenticated;
