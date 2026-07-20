-- Konfigurér → Handheld-design: kundens egen opsætning af håndterminalens
-- startskærm. Nøjagtig samme model som company_home_config:
--   findes der EN række for virksomheden, bruges den;
--   findes der ingen, falder håndterminalen tilbage til platformens standard
--   (platform_settings.handheld_tiles/handheld_design).
--
-- Derfor oprettes der bevidst ingen række ved oprettelse af en ny kunde: en ny
-- kunde "arver" platformens design ved netop ikke at have sin egen række, og en
-- senere ændring af Operia-standarden slår igennem hos alle der ikke selv har
-- taget stilling. Første gang kunden gemmer, oprettes rækken med det design de
-- så — altså med platformens design som udgangspunkt.

create table public.company_handheld_config (
  company_id uuid primary key references public.companies (id) on delete cascade,
  handheld_tiles jsonb not null default '[]'::jsonb,
  handheld_design jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger company_handheld_config_set_updated_at
  before update on public.company_handheld_config
  for each row execute function public.set_updated_at();

alter table public.company_handheld_config enable row level security;

-- Læsning for alle i virksomheden: håndterminalen henter designet som den
-- indloggede handler, ikke som manager.
create policy company_handheld_config_select on public.company_handheld_config
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

create policy company_handheld_config_write on public.company_handheld_config
  for all to authenticated
  using ((company_id = public.current_company_id() and public.has_role('manager')) or public.is_platform_admin())
  with check ((company_id = public.current_company_id() and public.has_role('manager')) or public.is_platform_admin());

grant select, insert, update, delete on public.company_handheld_config to authenticated;

-- Audit (NIS2): 'handheld.updated' pr. virksomhed (company_id sat, i modsætning
-- til platformens handheld.updated med company_id = null). Kategorien
-- 'handheld' → 'branding' er allerede defineret i handheld_design-migrationen.
create or replace function public.audit_company_handheld_config()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.record_audit(new.company_id, 'handheld.updated', 'company_handheld_config',
    new.company_id::text, null,
    jsonb_build_object('tiles', jsonb_array_length(new.handheld_tiles),
                       'design', new.handheld_design));
  return new;
end;
$$;

create trigger audit_company_handheld_config_trg
  after insert or update on public.company_handheld_config
  for each row execute function public.audit_company_handheld_config();
