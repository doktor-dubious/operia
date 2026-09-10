-- Regnskabsintegration: Visma e-conomic som første udbyder.
--
-- Samme to-niveau-model som Entra og Slack:
--   1) Platform (DCA): udbydes integrationen overhovedet, hvilke udbydere, og
--      DCA's egen app-hemmelighed hos udbyderen (e-conomic: AppSecretToken —
--      én pr. platform, fordi det er DCA's app der er registreret hos Visma).
--   2) Pr. kunde: er den slået til, hvilken udbyder, og kundens egen adgang
--      (e-conomic: AgreementGrantToken — kundens tilladelse til at DCA's app
--      må røre netop deres regnskab).
--
-- Begge hemmeligheder følger mønsteret fra company_entra_secret: tabeller uden
-- RLS-politikker og uden grants, som kun edge-funktionen economic-config rører.
-- UI'et ser kun spejlede "sat ✓"-flag — aldrig selve værdierne.
--
-- Nyt i denne migration: en PLATFORM-hemmelighed i databasen (platform_secrets).
-- Hidtil har platformens egne nøgler (Slack client secret, Resend) ligget som
-- edge-secrets sat fra CLI'en. Her skal DCA-staben kunne indtaste tokenet på
-- Operia → Integrationer, så den bor i en nøgle/værdi-tabel med samme
-- adgangsregler som kundehemmelighederne.
--
-- Ingen fakturering endnu: integrationen forbinder og verificerer (GET /self)
-- — fakturakladder, produkter og debitorer kommer i de næste trin (EVU C-01..).

-- ---------------------------------------------------------------------------
-- 1) Platformens udbud
-- ---------------------------------------------------------------------------
alter table public.platform_settings
  add column accounting_enabled boolean not null default false,
  -- Hvilke udbydere kunderne kan vælge imellem (som ai_providers). Katalog:
  -- web/src/lib/accounting.ts — en nøgle der kun findes dér, afvises her.
  add column accounting_providers text[] not null default '{}'::text[],
  -- Spejles fra platform_secrets af trigger nedenfor; browseren kan aldrig
  -- læse tokenet, kun se at det er sat.
  add column economic_app_secret_set boolean not null default false;

alter table public.platform_settings
  add constraint platform_settings_accounting_providers_check
    check (accounting_providers <@ array['economic']::text[]);

-- ---------------------------------------------------------------------------
-- 2) Platform-hemmeligheder (KUN service-role)
-- ---------------------------------------------------------------------------
create table public.platform_secrets (
  key text primary key,
  value text,
  updated_by uuid, -- bevidst uden FK: sletning af en admin må ikke ændre rækken
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger platform_secrets_set_updated_at
  before update on public.platform_secrets
  for each row execute function public.set_updated_at();

alter table public.platform_secrets enable row level security;
revoke all on public.platform_secrets from anon, authenticated;

comment on table public.platform_secrets is
  'Platformens egne hemmeligheder (fx e-conomic AppSecretToken). Ingen RLS-politikker og ingen grants — kun edge-funktioner (service-role) læser og skriver. Nøgler: economic_app_secret_token.';

-- Spejl "er tokenet sat" over i platform_settings, som UI'et må læse.
create or replace function public.sync_platform_secret_flags()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_key text := coalesce(new.key, old.key);
  v_set boolean := coalesce(new.value, '') <> '';
begin
  if v_key = 'economic_app_secret_token' then
    update public.platform_settings set economic_app_secret_set = v_set where id;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger platform_secrets_mirror_flags
  after insert or update or delete on public.platform_secrets
  for each row execute function public.sync_platform_secret_flags();

-- Spejlet må ikke kunne forfalskes fra browseren: en platform-admin kan
-- opdatere platform_settings, men flaget skal afspejle platform_secrets.
-- Serveren selv (trigger/service-role) har ikke auth.uid().
create or replace function public.guard_platform_settings_mirrors()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.economic_app_secret_set := old.economic_app_secret_set;
  end if;
  return new;
end;
$$;

create trigger platform_settings_guard_mirrors
  before update on public.platform_settings
  for each row execute function public.guard_platform_settings_mirrors();

-- ---------------------------------------------------------------------------
-- 3) Pr. kunde: konfiguration (kunde-redigerbar) + verifikationsstatus
-- ---------------------------------------------------------------------------
create table public.company_accounting_config (
  company_id uuid primary key references public.companies (id) on delete cascade,
  enabled boolean not null default false,
  provider text not null default 'economic',
  -- Spejles fra company_accounting_secret af trigger nedenfor.
  token_set boolean not null default false,
  -- Fra seneste vellykkede "Test forbindelse" (GET /self): hvilket regnskab
  -- tokenet giver adgang til. Vises, så manageren kan se at det er det rigtige
  -- aftalenummer — nulstilles når tokenet skiftes.
  agreement_number integer,
  agreement_company_name text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_accounting_config_provider_check check (provider in ('economic'))
);

create trigger company_accounting_config_set_updated_at
  before update on public.company_accounting_config
  for each row execute function public.set_updated_at();

alter table public.company_accounting_config enable row level security;

create policy company_accounting_config_select on public.company_accounting_config
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

-- Managere skriver enabled/provider selv (som company_entra_config); status-
-- kolonnerne værnes af triggeren nedenfor.
create policy company_accounting_config_insert on public.company_accounting_config
  for insert to authenticated
  with check (
    (company_id = public.current_company_id() and public.has_any_role('manager'))
    or public.is_platform_admin()
  );

create policy company_accounting_config_update on public.company_accounting_config
  for update to authenticated
  using (
    (company_id = public.current_company_id() and public.has_any_role('manager'))
    or public.is_platform_admin()
  )
  with check (
    (company_id = public.current_company_id() and public.has_any_role('manager'))
    or public.is_platform_admin()
  );

-- Projektets default ACL giver authenticated alt på nye tabeller (se
-- 20260904091000) — stram til præcis det UI'et bruger.
revoke all on public.company_accounting_config from anon, authenticated;
grant select, insert, update on public.company_accounting_config to authenticated;

-- Statusfelterne skrives kun af serveren (economic-config). Klienten må ikke
-- kunne forfalske "token sat" eller "verificeret". Skellet som i
-- guard_entra_config_status: en slutbruger har altid auth.uid(); service-role
-- og direkte SQL har ikke. Platform-admin (DCA-support) må rette op.
create or replace function public.guard_accounting_config_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_platform_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.token_set := false;
    new.agreement_number := null;
    new.agreement_company_name := null;
    new.verified_at := null;
    return new;
  end if;
  new.token_set := old.token_set;
  new.agreement_number := old.agreement_number;
  new.agreement_company_name := old.agreement_company_name;
  new.verified_at := old.verified_at;
  -- Skift af udbyder ⇒ tidligere verifikation gælder ikke længere.
  if new.provider is distinct from old.provider then
    new.agreement_number := null;
    new.agreement_company_name := null;
    new.verified_at := null;
  end if;
  return new;
end;
$$;

create trigger company_accounting_config_guard_status
  before insert or update on public.company_accounting_config
  for each row execute function public.guard_accounting_config_status();

-- ---------------------------------------------------------------------------
-- 4) Pr. kunde: adgangstoken (KUN service-role)
-- ---------------------------------------------------------------------------
create table public.company_accounting_secret (
  company_id uuid primary key references public.companies (id) on delete cascade,
  -- e-conomic: AgreementGrantToken. Kolonnen er udbyder-neutral navngivet, så
  -- en anden udbyders nøgle kan bo samme sted.
  access_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger company_accounting_secret_set_updated_at
  before update on public.company_accounting_secret
  for each row execute function public.set_updated_at();

alter table public.company_accounting_secret enable row level security;
revoke all on public.company_accounting_secret from anon, authenticated;

comment on table public.company_accounting_secret is
  'Kundens adgangstoken til regnskabssystemet (e-conomic AgreementGrantToken). Ingen RLS-politikker og ingen grants — kun edge-funktionen economic-config læser og skriver.';

-- Spejl "er tokenet sat" over i konfigurationen. Et nyt eller fjernet token
-- nulstiller også verifikationen — den gjaldt det gamle token.
create or replace function public.sync_accounting_secret_flag()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := coalesce(new.company_id, old.company_id);
  v_set boolean := coalesce(new.access_token, '') <> '';
begin
  update public.company_accounting_config
     set token_set = v_set,
         agreement_number = null,
         agreement_company_name = null,
         verified_at = null
   where company_id = v_company;
  return coalesce(new, old);
end;
$$;

create trigger company_accounting_secret_mirror_flag
  after insert or update or delete on public.company_accounting_secret
  for each row execute function public.sync_accounting_secret_flag();

-- ---------------------------------------------------------------------------
-- 5) Revision (NIS2)
-- ---------------------------------------------------------------------------
-- Taksonomi: accounting.* → ny kategori 'accounting'. Klient-spejl:
-- web/src/routes/_app/operia.logs.tsx (CATEGORIES + categoryOf). Uændret i
-- øvrigt fra 20260829090200.
create or replace function public.audit_category(p_action text)
returns text language sql immutable as $$
  select case split_part(coalesce(p_action, ''), '.', 1)
    when 'parcel'         then 'parcels'
    when 'parcel_flow'    then 'parcels'
    when 'employee'       then 'directory'
    when 'department'     then 'directory'
    when 'location'       then 'config'
    when 'handling_class' then 'config'
    when 'carrier'        then 'config'
    when 'general'        then 'config'
    when 'shipping'       then 'shipping'
    when 'agreement'      then 'shipping'
    when 'asset'          then 'assets'
    when 'asset_category' then 'assets'
    when 'asset_location' then 'assets'
    when 'asset_flow'     then 'assets'
    when 'assets'         then 'assets'
    when 'booking'          then 'booking'
    when 'booking_category' then 'booking'
    when 'booking_resource' then 'booking'
    when 'inventory_item' then 'inventory'
    when 'locker'         then 'lockers'
    when 'user'           then 'access'
    when 'auth'           then 'access'
    when 'product'        then 'entitlements'
    when 'feature'        then 'entitlements'
    when 'template'       then 'branding'
    when 'language'       then 'branding'
    when 'currency'       then 'branding'
    when 'appearance'     then 'branding'
    when 'product_text'   then 'branding'
    when 'home'           then 'branding'
    when 'handheld'       then 'branding'
    when 'maps'           then 'maps'
    when 'route'          then 'maps'
    when 'import'         then 'imports'
    when 'import_config'  then 'imports'
    when 'data_transfer'  then 'imports'
    when 'log_drain'      then 'log'
    when 'retention'      then 'log'
    when 'ai'             then 'ai'
    when 'privacy'        then 'compliance'
    when 'accounting'     then 'accounting'
    else 'other'
  end
$$;

-- Platformens udbud: enhver ændring logges (som audit_platform_entra).
create or replace function public.audit_platform_accounting()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.accounting_enabled is distinct from old.accounting_enabled
     or new.accounting_providers is distinct from old.accounting_providers
     or new.economic_app_secret_set is distinct from old.economic_app_secret_set then
    perform public.record_audit(null, 'accounting.platform_changed', 'platform_settings', 'platform', null,
      jsonb_build_object('enabled', new.accounting_enabled,
                         'providers', to_jsonb(new.accounting_providers),
                         'economic_app_secret_set', new.economic_app_secret_set));
  end if;
  return new;
end;
$$;

create trigger platform_settings_audit_accounting
  after update on public.platform_settings
  for each row execute function public.audit_platform_accounting();

-- Kundens konfiguration: kun reelle ændringer (ikke verifikations-stempler,
-- som edge-funktionen selv logger som accounting.verified).
create or replace function public.audit_company_accounting_config()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and new.enabled is not distinct from old.enabled
     and new.provider is not distinct from old.provider
     and new.token_set is not distinct from old.token_set then
    return new;
  end if;
  perform public.record_audit(new.company_id, 'accounting.config_updated', 'accounting_config',
    new.company_id::text, null,
    jsonb_build_object('enabled', new.enabled, 'provider', new.provider,
                       'token_set', new.token_set));
  return new;
end;
$$;

create trigger company_accounting_config_audit
  after insert or update on public.company_accounting_config
  for each row execute function public.audit_company_accounting_config();
