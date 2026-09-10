-- Brevo som e-mail-udbyder (udgående + indgående), valgbar på Operia →
-- Integrationer.
--
-- Hidtil har e-mail haft ÉN hårdkodet udbyder i hver ende:
--   • udgående: Resend (US)   — invitationer, adgangskode-nulstilling,
--     pakke-/aktivnotifikationer, beregneren på salgssitet
--   • indgående: Postmark (US) — Flow 0's e-mail-kanal (HR-CSV som vedhæftning)
-- Begge er amerikanske. docs/gdpr/subprocessors.md §5 noterer netop e-mail som
-- det sidste hul i en "kun EU"-opsætning. Brevo (Sendinblue SAS, Paris) kan
-- begge dele fra EU og lukker hullet.
--
-- Udbyderne UDSKIFTES IKKE — de vælges. Resend/Postmark bliver liggende som
-- fuldgyldige alternativer, så en driftsforstyrrelse hos Brevo kan afhjælpes
-- med et enkelt valg i UI'et i stedet for en deploy.
--
-- Modellen er den samme som regnskabsintegrationen (20260905090000):
--   • valget selv står i platform_settings (læsbart for UI'et)
--   • API-nøglen står i platform_secrets (ingen RLS-politikker, ingen grants —
--     kun edge-funktionen mail-config rører den) og spejles som et "sat ✓"-flag
--
-- Nøglerne skal matche katalogerne i web/src/lib/mail.ts og
-- supabase/functions/_shared/send-email.ts.

-- ---------------------------------------------------------------------------
-- 1) Udbydervalg + afsenderadresse
-- ---------------------------------------------------------------------------
alter table public.platform_settings
  -- Udgående transaktionsmail.
  add column email_provider text not null default 'resend',
  -- Indgående (Flow 0's e-mail-kanal). Egen kolonne, fordi de to ender kan
  -- flyttes hver for sig: MX-posten skifter DNS-udbyder, den udgående gør ikke.
  add column email_inbound_provider text not null default 'postmark',
  -- Afsenderen ("Operia <noreply@…>"). Var før kun edge-secret RESEND_FROM;
  -- her kan den sættes i UI'et, fordi et udbyderskift som regel også betyder
  -- en ny verificeret afsenderadresse. Tom = fald tilbage på edge-secret.
  add column email_from text,
  -- Spejles fra platform_secrets af triggeren nedenfor; browseren kan aldrig
  -- læse nøglen, kun se at den er sat.
  add column brevo_api_key_set boolean not null default false;

alter table public.platform_settings
  add constraint platform_settings_email_provider_check
    check (email_provider in ('resend', 'brevo')),
  add constraint platform_settings_email_inbound_provider_check
    check (email_inbound_provider in ('postmark', 'brevo')),
  -- "a@b.dk" eller "Navn <a@b.dk>" — fanger den typiske indtastningsfejl før
  -- den bliver til en tavs 400 hos udbyderen.
  add constraint platform_settings_email_from_check
    check (
      email_from is null
      or email_from ~ '^([^<>]{0,70}<[^@[:space:]<>]+@[^@[:space:]<>]+\.[^@[:space:]<>]+>|[^@[:space:]<>]+@[^@[:space:]<>]+\.[^@[:space:]<>]+)$'
    );

comment on column public.platform_settings.email_provider is
  'Udgående e-mail-udbyder: resend (US) eller brevo (EU/FR). Katalog: web/src/lib/mail.ts.';
comment on column public.platform_settings.email_inbound_provider is
  'Indgående e-mail-udbyder for Flow 0''s e-mail-kanal: postmark (US) eller brevo (EU/FR). Styrer hvilke MX-poster der skal stå i DNS — edge-funktionen email-inbound tager imod begge nyttelast-former.';
comment on column public.platform_settings.email_from is
  'Afsenderadresse for udgående mail ("Operia <noreply@…>"). Tom = edge-secret RESEND_FROM/BREVO_FROM. Adressen skal være verificeret hos den valgte udbyder.';
comment on column public.platform_settings.brevo_api_key_set is
  'Spejl af platform_secrets[''brevo_api_key''] — sat/ikke sat. Selve nøglen kan aldrig læses fra browseren.';

-- ---------------------------------------------------------------------------
-- 2) Spejling af platform-hemmeligheden
-- ---------------------------------------------------------------------------
-- Udvider funktionen fra 20260905090000 med Brevo-nøglen. Nøglenavnet
-- 'brevo_api_key' bruges af edge-funktionerne mail-config, send-email og
-- email-inbound.
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
  end if;
  return coalesce(new, old);
end;
$$;

-- Samme værn som for e-conomic: en platform-admin må gerne opdatere
-- platform_settings, men ikke sætte spejl-flaget selv.
create or replace function public.guard_platform_settings_mirrors()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.economic_app_secret_set := old.economic_app_secret_set;
    new.brevo_api_key_set := old.brevo_api_key_set;
  end if;
  return new;
end;
$$;

-- Nøglen kan allerede være sat (fx via en tidligere upsert) — bring flaget i
-- sync ved installation, så UI'et ikke viser "mangler" for en nøgle der er der.
update public.platform_settings ps
set brevo_api_key_set = exists (
  select 1 from public.platform_secrets s
  where s.key = 'brevo_api_key' and coalesce(s.value, '') <> ''
)
where ps.id;
