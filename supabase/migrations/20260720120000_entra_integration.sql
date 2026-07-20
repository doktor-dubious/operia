-- Integration: Microsoft Entra ID (Active Directory) som kilde til Flow 0-
-- medarbejderdirektoriet. Samme to-niveau-model som dataoverførsel:
--   1) Platform (DCA): udbyder Operia overhovedet AD-integrationen, og hvad er
--      standardpolitikken for nye kunder (anonymisering, synk-interval).
--   2) Pr. virksomhed: kundens egne Entra-credentials + overstyringer.
-- Credentials ligger i en separat tabel som KUN service-role kan læse/skrive
-- (edge-funktionen entra-config) — client secret må aldrig nå browseren.

-- ---------------------------------------------------------------------------
-- 1) Stabil ekstern nøgle på medarbejderen
-- ---------------------------------------------------------------------------
-- Entra-brugerens objekt-GUID. Uforanderlig i modsætning til medarbejder-nr.
-- (som kunden kan omnummerere) og e-mail (som ændrer sig ved navneskifte), og
-- derfor synkroniseringens primære match-nøgle. Nulstilles ved anonymisering
-- (se næste migration): en anonymiseret række må ikke kunne kobles til en
-- person igen.
alter table public.employees
  add column external_id text;

comment on column public.employees.external_id is
  'Ekstern uforanderlig nøgle (Entra objekt-GUID). Nulstilles ved anonymisering.';

create unique index employees_company_external_id_key
  on public.employees (company_id, external_id)
  where external_id is not null;

-- ---------------------------------------------------------------------------
-- 2) Platform-globale indstillinger
-- ---------------------------------------------------------------------------
alter table public.platform_settings
  -- Hovedafbryder: uden denne er AD-integrationen skjult for alle kunder.
  add column entra_enabled boolean not null default false,
  -- Standardpolitik for nye kunder; kunden kan overstyre (null = arv herfra).
  add column entra_anonymize_retired boolean not null default false,
  add column entra_sync_interval_minutes int not null default 1440;

alter table public.platform_settings
  add constraint platform_settings_entra_interval_check
  check (entra_sync_interval_minutes in (15, 60, 240, 720, 1440, 10080));

-- ---------------------------------------------------------------------------
-- 3) Pr. virksomhed: konfiguration (kunde-redigerbar)
-- ---------------------------------------------------------------------------
-- Bemærk om arv: anonymize_retired og sync_interval_minutes er NULLABLE, og
-- null betyder "arv platformens værdi". Det giver begge de ønskede egenskaber
-- på én gang — nye kunder starter på platformens standard, OG en ændring af
-- standarden slår igennem hos alle der ikke selv har taget stilling.
create table public.company_entra_config (
  company_id uuid primary key references public.companies (id) on delete cascade,
  enabled boolean not null default false,
  tenant_id text,
  client_id text,
  -- Spejles fra company_entra_secret af trigger, så UI kan vise "sat ✓" uden
  -- nogensinde at kunne læse selve hemmeligheden.
  client_secret_set boolean not null default false,
  -- Valgfrit gruppefilter: kun medlemmer af denne Entra-gruppe synkroniseres.
  -- Uden filter hentes hele direktoriet (minus gæster/servicekonti).
  group_id text,
  group_name text,
  -- Entra har ingen initial-attribut. Navnet på en attribut der skal bruges
  -- (fx 'mailNickname' eller 'extension_…'); null = udled af navnet.
  initials_source text,
  anonymize_retired boolean,        -- null = arv fra platform
  sync_interval_minutes int,        -- null = arv fra platform
  -- Tørkørsel skal gennemføres før første rigtige synk kan køre. Nulstilles
  -- når credentials eller filter ændres, så en ny opsætning ikke arver en
  -- gammel godkendelse.
  dry_run_at timestamptz,
  first_sync_at timestamptz,
  last_sync_at timestamptz,
  last_sync_status text check (last_sync_status in ('ok', 'rejected', 'failed')),
  last_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_entra_config_interval_check
    check (sync_interval_minutes is null
           or sync_interval_minutes in (15, 60, 240, 720, 1440, 10080))
);

create trigger company_entra_config_set_updated_at
  before update on public.company_entra_config
  for each row execute function public.set_updated_at();

alter table public.company_entra_config enable row level security;

create policy company_entra_config_select on public.company_entra_config
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

create policy company_entra_config_write on public.company_entra_config
  for all to authenticated
  using ((company_id = public.current_company_id() and public.has_role('manager'))
         or public.is_platform_admin())
  with check ((company_id = public.current_company_id() and public.has_role('manager'))
              or public.is_platform_admin());

grant select, insert, update, delete on public.company_entra_config to authenticated;

-- Statusfelterne skrives kun af synkroniseringen (service-role). Klienten må
-- ikke kunne forfalske "sidst kørt ok" eller springe tørkørslen over.
create or replace function public.guard_entra_config_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_platform_admin() then
    return new; -- platform-admin (DCA-support) må rette op
  end if;
  new.dry_run_at := old.dry_run_at;
  new.first_sync_at := old.first_sync_at;
  new.last_sync_at := old.last_sync_at;
  new.last_sync_status := old.last_sync_status;
  new.last_sync_error := old.last_sync_error;
  new.client_secret_set := old.client_secret_set;
  -- Ny opsætning ⇒ tidligere godkendt tørkørsel gælder ikke længere.
  if new.tenant_id is distinct from old.tenant_id
     or new.client_id is distinct from old.client_id
     or new.group_id is distinct from old.group_id then
    new.dry_run_at := null;
  end if;
  return new;
end;
$$;

create trigger company_entra_config_guard_status
  before update on public.company_entra_config
  for each row execute function public.guard_entra_config_status();

-- ---------------------------------------------------------------------------
-- 4) Pr. virksomhed: client secret (KUN service-role)
-- ---------------------------------------------------------------------------
-- Ingen RLS-politikker og ingen grants: hverken kunde eller platform-admin kan
-- læse eller skrive tabellen gennem PostgREST. Den sættes udelukkende af edge-
-- funktionen entra-config, der selv verificerer at kalderen er manager i den
-- pågældende virksomhed. Hemmeligheden forlader aldrig serveren igen.
create table public.company_entra_secret (
  company_id uuid primary key references public.companies (id) on delete cascade,
  client_secret text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger company_entra_secret_set_updated_at
  before update on public.company_entra_secret
  for each row execute function public.set_updated_at();

alter table public.company_entra_secret enable row level security;
revoke all on public.company_entra_secret from anon, authenticated;

-- Spejl "er hemmeligheden sat" over i konfigurationen, som UI'et må læse.
create or replace function public.sync_entra_secret_flag()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := coalesce(new.company_id, old.company_id);
  v_set boolean := coalesce(new.client_secret, '') <> '';
begin
  update public.company_entra_config
     set client_secret_set = v_set
   where company_id = v_company;
  return coalesce(new, old);
end;
$$;

create trigger company_entra_secret_mirror_flag
  after insert or update or delete on public.company_entra_secret
  for each row execute function public.sync_entra_secret_flag();

-- ---------------------------------------------------------------------------
-- 5) CSV og AD udelukker hinanden
-- ---------------------------------------------------------------------------
-- Begge er "system of record" for de samme rækker; kører de samtidig, vil de
-- skiftevis deaktivere hinandens medarbejdere. Håndhæves begge veje.
create or replace function public.guard_entra_vs_csv()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.enabled and exists (
    select 1 from public.company_data_transfer d
     where d.company_id = new.company_id
       and (d.sftp_enabled or d.email_enabled)
  ) then
    raise exception 'entra_conflicts_with_csv'
      using hint = 'Deaktiver SFTP/e-mail-import før AD-synkronisering slås til.';
  end if;
  return new;
end;
$$;

create trigger company_entra_config_guard_csv
  before insert or update on public.company_entra_config
  for each row execute function public.guard_entra_vs_csv();

create or replace function public.guard_csv_vs_entra()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.sftp_enabled or new.email_enabled) and exists (
    select 1 from public.company_entra_config c
     where c.company_id = new.company_id and c.enabled
  ) then
    raise exception 'csv_conflicts_with_entra'
      using hint = 'Deaktiver AD-synkronisering før SFTP/e-mail-import slås til.';
  end if;
  return new;
end;
$$;

create trigger company_data_transfer_guard_entra
  before insert or update on public.company_data_transfer
  for each row execute function public.guard_csv_vs_entra();

-- ---------------------------------------------------------------------------
-- 6) Revision (NIS2) — enhver konfigurationsændring logges
-- ---------------------------------------------------------------------------
create or replace function public.audit_company_entra_config()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Kun reelle konfigurationsændringer; statusfelter fra synkroniseringen
  -- logges via import_runs, ikke i revisionsloggen (ellers drukner den).
  if tg_op = 'UPDATE'
     and new.enabled is not distinct from old.enabled
     and new.tenant_id is not distinct from old.tenant_id
     and new.client_id is not distinct from old.client_id
     and new.client_secret_set is not distinct from old.client_secret_set
     and new.group_id is not distinct from old.group_id
     and new.initials_source is not distinct from old.initials_source
     and new.anonymize_retired is not distinct from old.anonymize_retired
     and new.sync_interval_minutes is not distinct from old.sync_interval_minutes then
    return new;
  end if;
  perform public.record_audit(new.company_id, 'entra.config_updated', 'entra_config',
    new.company_id::text, null,
    jsonb_build_object('enabled', new.enabled, 'tenant_id', new.tenant_id,
                       'client_id', new.client_id, 'secret_set', new.client_secret_set,
                       'group_id', new.group_id, 'group_name', new.group_name,
                       'initials_source', new.initials_source,
                       'anonymize_retired', new.anonymize_retired,
                       'sync_interval_minutes', new.sync_interval_minutes));
  return new;
end;
$$;

create trigger company_entra_config_audit
  after insert or update on public.company_entra_config
  for each row execute function public.audit_company_entra_config();

create or replace function public.audit_platform_entra()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.entra_enabled is distinct from old.entra_enabled
     or new.entra_anonymize_retired is distinct from old.entra_anonymize_retired
     or new.entra_sync_interval_minutes is distinct from old.entra_sync_interval_minutes then
    perform public.record_audit(null, 'entra.platform_changed', 'platform_settings', 'platform', null,
      jsonb_build_object('enabled', new.entra_enabled,
                         'anonymize_retired', new.entra_anonymize_retired,
                         'sync_interval_minutes', new.entra_sync_interval_minutes));
  end if;
  return new;
end;
$$;

create trigger platform_settings_audit_entra
  after update on public.platform_settings
  for each row execute function public.audit_platform_entra();
