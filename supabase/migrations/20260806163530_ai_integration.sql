-- Integration: AI (label-læsning m.m.). Samme to-niveau-model som Entra:
--   1) Platform (DCA): udbyder Operia overhovedet AI, og hvilke udbydere/
--      modeller kunderne må vælge imellem (checkbokse på Operia → Integrationer).
--   2) Pr. virksomhed: kundens eget valg af udbyder + model (select/radio på
--      Konfigurér → Integrationer) — begrænset til platformens udvalg.
-- API-nøglerne er DCA's egne og ligger som edge-function-secrets (CLAUDE_API,
-- DEEPSEEK_API) — aldrig i databasen og aldrig i browseren. Selve AI-kaldet
-- sker i edge-funktionen ai-read-label, som genchecker hele kæden server-side.
--
-- Kataloget (udbydere, modeller, vision-egenskab) er en kodekonstant, spejlet i
-- web/src/lib/ai.ts og supabase/functions/ai-read-label/index.ts. Check-
-- constraints her skal holdes i sync med begge — en værdi der kun findes i
-- koden, afvises af databasen.

-- ---------------------------------------------------------------------------
-- 1) Platform-globale indstillinger
-- ---------------------------------------------------------------------------
alter table public.platform_settings
  -- Hovedafbryder: uden denne er AI-integrationen skjult for alle kunder.
  add column ai_enabled boolean not null default false,
  -- Udbydere/modeller kunderne må vælge imellem (tomme = intet at vælge).
  add column ai_providers text[] not null default '{}',
  add column ai_models text[] not null default '{}';

alter table public.platform_settings
  add constraint platform_settings_ai_providers_check
  check (ai_providers <@ array['anthropic', 'openai', 'xai', 'deepseek']::text[]);

alter table public.platform_settings
  add constraint platform_settings_ai_models_check
  check (ai_models <@ array[
    'claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5', 'claude-fable-5',
    'deepseek-chat', 'deepseek-reasoner'
  ]::text[]);

-- ---------------------------------------------------------------------------
-- 2) Pr. virksomhed: kundens valg (kunde-redigerbar)
-- ---------------------------------------------------------------------------
-- Håndterminalen læser rækken for at vide om "Scan label"-knappen skal vises,
-- så select-politikken gælder hele virksomheden (som company_handheld_config),
-- mens kun managers kan ændre valget. At valget ligger inden for platformens
-- udvalg håndhæves i UI + edge-funktionen (udvalget kan ændre sig når som
-- helst; et forældet valg skal blot afvises ved brug, ikke låse rækken).
create table public.company_ai_config (
  company_id uuid primary key references public.companies (id) on delete cascade,
  provider text check (provider in ('anthropic', 'openai', 'xai', 'deepseek')),
  model text check (model in (
    'claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5', 'claude-fable-5',
    'deepseek-chat', 'deepseek-reasoner'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger company_ai_config_set_updated_at
  before update on public.company_ai_config
  for each row execute function public.set_updated_at();

alter table public.company_ai_config enable row level security;

create policy company_ai_config_select on public.company_ai_config
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

create policy company_ai_config_write on public.company_ai_config
  for all to authenticated
  using ((company_id = public.current_company_id() and public.has_role('manager'))
         or public.is_platform_admin())
  with check ((company_id = public.current_company_id() and public.has_role('manager'))
              or public.is_platform_admin());

grant select, insert, update, delete on public.company_ai_config to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Revision (NIS2) — enhver konfigurationsændring logges
-- ---------------------------------------------------------------------------
create or replace function public.audit_company_ai_config()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and new.provider is not distinct from old.provider
     and new.model is not distinct from old.model then
    return new;
  end if;
  perform public.record_audit(new.company_id, 'ai.config_updated', 'ai_config',
    new.company_id::text, null,
    jsonb_build_object('provider', new.provider, 'model', new.model));
  return new;
end;
$$;

create trigger company_ai_config_audit
  after insert or update on public.company_ai_config
  for each row execute function public.audit_company_ai_config();

create or replace function public.audit_platform_ai()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.ai_enabled is distinct from old.ai_enabled
     or new.ai_providers is distinct from old.ai_providers
     or new.ai_models is distinct from old.ai_models then
    perform public.record_audit(null, 'ai.platform_changed', 'platform_settings', 'platform', null,
      jsonb_build_object('enabled', new.ai_enabled,
                         'providers', new.ai_providers,
                         'models', new.ai_models));
  end if;
  return new;
end;
$$;

create trigger platform_settings_audit_ai
  after update on public.platform_settings
  for each row execute function public.audit_platform_ai();
