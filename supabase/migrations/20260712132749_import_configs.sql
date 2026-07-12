-- Importkonfiguration pr. virksomhed (Import → Konfiguration): filformatet
-- for medarbejderimporten (og senere aktiv-/lagerimport) — header/footer,
-- separator og de aktive felter i rækkefølge. employee_no og name er
-- obligatoriske (håndhæves i UI og her).
create table public.import_configs (
  company_id uuid not null references public.companies (id) on delete cascade,
  import_type text not null default 'employees'
    check (import_type in ('employees', 'assets', 'inventory')),
  has_header boolean not null default true,
  has_footer boolean not null default false,
  separator text not null default ',' check (char_length(separator) between 1 and 3),
  fields text[] not null
    default '{employee_no,name,initials,email,phone,department,language,nfc_card_id,role}',
  updated_at timestamptz not null default now(),
  primary key (company_id, import_type),
  check (fields @> '{employee_no,name}')
);

create trigger import_configs_set_updated_at
  before update on public.import_configs
  for each row execute function public.set_updated_at();

alter table public.import_configs enable row level security;

create policy import_configs_select on public.import_configs
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

create policy import_configs_write on public.import_configs
  for all to authenticated
  using ((company_id = public.current_company_id() and public.has_role('manager')) or public.is_platform_admin())
  with check ((company_id = public.current_company_id() and public.has_role('manager')) or public.is_platform_admin());

grant select, insert, update, delete on public.import_configs to authenticated;

-- Revisionslog: hver gemning logges med den fulde konfiguration i detail.
create or replace function public.audit_import_configs()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.record_audit(old.company_id, 'import_config.deleted', 'import_config',
      old.import_type, old.import_type);
    return old;
  end if;
  perform public.record_audit(new.company_id,
    case when tg_op = 'INSERT' then 'import_config.created' else 'import_config.updated' end,
    'import_config', new.import_type, new.import_type,
    jsonb_build_object(
      'has_header', new.has_header,
      'has_footer', new.has_footer,
      'separator', new.separator,
      'fields', new.fields
    ));
  return new;
end;
$$;

create trigger audit_import_configs_trg
  after insert or update or delete on public.import_configs
  for each row execute function public.audit_import_configs();
