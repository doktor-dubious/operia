-- AhaSend som tredje udgående e-mail-udbyder.
--
-- Hvorfor endnu en: Brevo løste EU-spørgsmålet, men viste sig at OMSKRIVE alle
-- links til klik-sporing (*.sendibt3.com) uden mulighed for at slå det fra på
-- transaktionsmail. For en adgangskode-nulstilling er det tre problemer på én
-- gang: linket er ENGANGS (en mailscanner der følger det wrappede link kan
-- bruge tokenet op), Brevo registrerer at en navngiven modtager klikkede, og et
-- nulstillingslink til et fremmed domæne ligner phishing.
--
-- AhaSend (TakTek GmbH, Wien) er EU-hostet OG har sporing slået fra som
-- standard, med headere pr. besked der kan tvinge den af uanset kontoens
-- indstilling. Den kombination har hverken Resend (US) eller Brevo (sporing kan
-- ikke fravælges).
--
-- Ingen udbyder fjernes: valget står stadig på Operia → Integrationer → E-mail,
-- og Resend/Brevo bliver liggende, så en driftsforstyrrelse er et dropdown-valg.
--
-- AhaSend kræver TO ting: en API-nøgle (hemmelig, platform_secrets) og et
-- account_id (en UUID i URL'en, ikke en hemmelighed — den står i
-- platform_settings, så den kan redigeres og læses i UI'et).

-- ---------------------------------------------------------------------------
-- 1) Udbyderen skal kunne vælges
-- ---------------------------------------------------------------------------
alter table public.platform_settings
  drop constraint platform_settings_email_provider_check;

alter table public.platform_settings
  add constraint platform_settings_email_provider_check
    check (email_provider in ('resend', 'brevo', 'ahasend'));

alter table public.platform_settings
  add column ahasend_account_id text,
  -- Spejles fra platform_secrets af triggeren nedenfor.
  add column ahasend_api_key_set boolean not null default false;

alter table public.platform_settings
  add constraint platform_settings_ahasend_account_id_check
    check (
      ahasend_account_id is null
      or ahasend_account_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    );

comment on column public.platform_settings.ahasend_account_id is
  'AhaSend-kontoens UUID. Indgår i send-URL''en (/v2/accounts/{id}/messages) — ikke en hemmelighed, derfor her og ikke i platform_secrets.';
comment on column public.platform_settings.ahasend_api_key_set is
  'Spejl af platform_secrets[''ahasend_api_key''] — sat/ikke sat. Selve nøglen kan aldrig læses fra browseren.';

-- ---------------------------------------------------------------------------
-- 2) Beskeder fra AhaSend skal kunne matches af bounce-webhooken
-- ---------------------------------------------------------------------------
-- Uden denne ville record_account_email fejle på check-constraint'en, og
-- nulstillings-/invitationsmails sendt via AhaSend ville miste deres spor.
alter table public.account_emails
  drop constraint account_emails_provider_check;

alter table public.account_emails
  add constraint account_emails_provider_check
    check (provider in ('resend', 'brevo', 'ahasend'));

-- ---------------------------------------------------------------------------
-- 3) Spejling af hemmeligheden
-- ---------------------------------------------------------------------------
create or replace function public.sync_platform_secret_flags()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_key text := coalesce(new.key, old.key);
  v_set boolean := coalesce(new.value, '') <> '';
begin
  if v_key = 'economic_app_secret_token' then
    update public.platform_settings set economic_app_secret_set = v_set where id;
  elsif v_key = 'brevo_api_key' then
    update public.platform_settings set brevo_api_key_set = v_set where id;
  elsif v_key = 'ahasend_api_key' then
    update public.platform_settings set ahasend_api_key_set = v_set where id;
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.guard_platform_settings_mirrors()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.economic_app_secret_set := old.economic_app_secret_set;
    new.brevo_api_key_set := old.brevo_api_key_set;
    new.ahasend_api_key_set := old.ahasend_api_key_set;
  end if;
  return new;
end;
$$;

update public.platform_settings ps
set ahasend_api_key_set = exists (
  select 1 from public.platform_secrets s
  where s.key = 'ahasend_api_key' and coalesce(s.value, '') <> ''
)
where ps.id;
