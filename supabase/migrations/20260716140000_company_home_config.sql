-- Kundekonfiguration → Home-design: pr. virksomhed overstyring af startsidens
-- (Home) fliselayout og designindstillinger. Findes en række for virksomheden,
-- bruger Home den i stedet for platformens standard
-- (platform_settings.home_tiles/home_design). Kundens editor starter fra
-- platformens design, men kun med de produkter virksomheden har adgang til.
-- Kunde-redigerbart (managers) — samme to-nøgle-RLS-mønster som
-- company_data_transfer.
create table public.company_home_config (
  company_id uuid primary key references public.companies (id) on delete cascade,
  home_tiles jsonb not null default '[]'::jsonb,
  home_design jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger company_home_config_set_updated_at
  before update on public.company_home_config
  for each row execute function public.set_updated_at();

alter table public.company_home_config enable row level security;

create policy company_home_config_select on public.company_home_config
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

create policy company_home_config_write on public.company_home_config
  for all to authenticated
  using ((company_id = public.current_company_id() and public.has_role('manager')) or public.is_platform_admin())
  with check ((company_id = public.current_company_id() and public.has_role('manager')) or public.is_platform_admin());

grant select, insert, update, delete on public.company_home_config to authenticated;

-- Audit (NIS2): log ændringer som 'home.updated' pr. virksomhed (company_id sat,
-- i modsætning til platformens home.updated med company_id = null). Kategorien
-- 'home' → 'branding' er allerede defineret (jf. home_tiles-migrationen).
create or replace function public.audit_company_home_config()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.record_audit(new.company_id, 'home.updated', 'company_home_config',
    new.company_id::text, null,
    jsonb_build_object('tiles', jsonb_array_length(new.home_tiles), 'design', new.home_design));
  return new;
end;
$$;

create trigger audit_company_home_config_trg
  after insert or update on public.company_home_config
  for each row execute function public.audit_company_home_config();
