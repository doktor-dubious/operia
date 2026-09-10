-- Bounces på konto-mails (nulstilling + invitation) skal kunne SES.
--
-- Hullet: begge e-mail-udbydere kvitterer kun "accepteret i køen". Om
-- postkassen findes afgøres senere og kommer tilbage som et webhook-event.
-- resend-webhook/brevo-webhook matcher det event mod provider_id på
-- parcel_notifications og asset_loan_notifications — men nulstillings- og
-- invitationsmails gemmer INTET id nogen steder. Et hårdt bounce på dem blev
-- derfor kvitteret og smidt væk uden en eneste log-linje: "jeg får ikke
-- mailen" kunne hverken be- eller afkræftes.
--
-- 20260905120000 lukkede den halvdel der sker SYNKRONT (email_sent/email_error
-- på selve anmodningen). Denne migration lukker den asynkrone halvdel: mailens
-- provider_id gemmes, så webhooken kan finde tilbage til den.
--
-- account_emails er bevidst et MATCH-INDEKS og ikke en beskedlog: modtageren
-- gemmes kun maskeret (samme regel som revisionsloggen — ingen PII), og rækker
-- ryddes opportunistisk efter 30 dage inde i RPC'en. Den står derfor med vilje
-- ikke i run_retention_purge: der er ingen personoplysninger at opbevare, og
-- tabellen skal ikke afhænge af at et cron-job kører.

-- ---------------------------------------------------------------------------
-- 1) Match-indekset
-- ---------------------------------------------------------------------------
create table public.account_emails (
  -- Udbyderens besked-id er den naturlige nøgle: webhooken slår op på præcis
  -- den, og en gen-levering bliver et no-op i stedet for en dublet.
  provider_id text primary key,
  kind text not null,
  provider text not null,
  -- ALDRIG den rå adresse. mask_login_email er den samme maskering som
  -- revisionsloggen bruger, så de to kan sammenlignes med det blotte øje.
  recipient_masked text not null,
  -- Bevidst uden FK (som audit_log): sletning af brugeren eller virksomheden
  -- må ikke fjerne sporet af at mailen bouncede.
  user_id uuid,
  company_id uuid,
  created_at timestamptz not null default now(),
  constraint account_emails_kind_check check (kind in ('password_reset', 'invite')),
  constraint account_emails_provider_check check (provider in ('resend', 'brevo'))
);

create index account_emails_created_at_idx on public.account_emails (created_at);

alter table public.account_emails enable row level security;
revoke all on public.account_emails from anon, authenticated;

-- Rettigheden gives EKSPLICIT og ikke via schemaets default privileges.
-- Baggrund: default privileges viste sig at variere mellem den kørende database
-- og en frisk opsætning fra migrationerne — company_entra_secret og
-- platform_secrets har fulde service_role-rettigheder i drift, men fik ingen
-- ved et lokalt `db reset`. Effekten er ubehagelig, fordi supabase-js ikke
-- kaster på en manglende rettighed: opslaget returnerer bare tomt, og
-- webhooken ville rapportere "intet match" i stedet for en fejl. Ved en
-- genopbygning fra migrationerne (docs/disaster-recovery.md) ville den slags
-- ramme lydløst.
--
-- Kun SELECT: alle skrivninger går gennem record_account_email (security
-- definer), så service-rollen aldrig behøver at kunne skrive i tabellen.
grant select on public.account_emails to service_role;

-- Samme sikring for de to eksisterende hemmelighedstabeller, som edge-
-- funktionerne (economic-config, mail-config, send-email) læser og skriver
-- gennem PostgREST. De HAR rettighederne i drift; det her gør blot at en
-- genopbygning fra migrationerne giver det samme resultat.
grant select, insert, update, delete on public.platform_secrets to service_role;

comment on table public.account_emails is
  'Match-indeks fra udbyderens besked-id til konto-mailen (nulstilling/invitation), så bounce-webhooken kan logge udfaldet. Ingen RLS-politikker og ingen grants — kun edge-funktioner (service-role). Modtageren gemmes maskeret; rækker ryddes efter 30 dage af record_account_email.';

-- ---------------------------------------------------------------------------
-- 2) Skriv en række (kaldes af _shared/reset-email.ts og invite-email.ts)
-- ---------------------------------------------------------------------------
-- Maskeringen ligger her og ikke i edge-funktionen, så en fremtidig kalder
-- ikke kan glemme den — samme begrundelse som log_password_reset_requested.
create or replace function public.record_account_email(
  p_kind        text,
  p_provider    text,
  p_provider_id text,
  p_email       text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email      text := lower(trim(coalesce(p_email, '')));
  v_user_id    uuid;
  v_company_id uuid;
begin
  if coalesce(p_provider_id, '') = '' or v_email = '' then
    return;
  end if;

  select u.id, au.company_id
    into v_user_id, v_company_id
  from auth.users u
  left join public.app_users au on au.user_id = u.id
  where lower(u.email) = v_email
  limit 1;

  insert into public.account_emails (
    provider_id, kind, provider, recipient_masked, user_id, company_id
  )
  values (
    p_provider_id, p_kind, p_provider, public.mask_login_email(v_email), v_user_id, v_company_id
  )
  on conflict (provider_id) do nothing;

  -- Opportunistisk oprydning: et bounce kommer inden for minutter til få døgn,
  -- så alt ældre end 30 dage kan aldrig matche igen.
  delete from public.account_emails where created_at < now() - interval '30 days';
exception when others then
  null; -- må aldrig kunne vælte selve afsendelsen
end;
$$;

revoke execute on function public.record_account_email(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_account_email(text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3) Niveauer
-- ---------------------------------------------------------------------------
-- De nye handlinger rammer allerede de generiske endelser:
--   *_bounced    → error    (auth.password_reset_bounced, user.invite_bounced)
--   *_complained → warning  (…_complained)
--
-- Til gengæld skal én gren GENINDSÆTTES. audit_level blev redefineret i
-- 20260908090000 (booking) oven på 20260905120000, og den redefinition
-- udelod grenen "auth.password_reset_requested med email_sent=false → error".
-- Konsekvensen var at en FEJLET nulstillingsmail stod som 'success' i Logs —
-- altså netop den hændelse loggen blev udvidet for at fange. Bekræftet mod den
-- kørende database 2026-09-08 (grenen manglede) før den blev sat ind igen her.
--
-- LÆRING: audit_level redefineres af mange migrationer. Kopiér ALTID den
-- nuværende krop (pg_get_functiondef) og tilføj din gren — ellers ruller man
-- tavst en tidligere migrations regel tilbage. Signaturens `default null` skal
-- desuden blive stående; audit_log.level er en genereret kolonne oven på den.
create or replace function public.audit_level(p_action text, p_detail jsonb default null)
returns text language sql immutable as $$
  select case
    when p_action = 'ai.label_read' then
      case
        when coalesce(p_detail->>'outcome', '') = 'ok' then 'success'
        when coalesce(p_detail->>'outcome', '') in (
          'integration_disabled', 'not_configured', 'not_allowed', 'not_accepted',
          'model_no_vision', 'forbidden', 'refused', 'image_too_large',
          'unsupported_media_type', 'rate_limited'
        ) then 'warning'
        else 'error'
      end
    when p_action = 'auth.password_reset_requested'
      and coalesce(p_detail->>'email_sent', '') = 'false' then 'error'
    when p_action = 'ai.disclosure_withdrawn' then 'warning'
    when p_action = 'parcel.removed'
      or p_action like '%.failed' or p_action like '%\_failed' escape '\'
      or p_action like '%.bounced' or p_action like '%\_bounced' escape '\'
      or p_action = 'data_transfer.spoof_rejected'
      then 'error'
    when p_action = 'import.rejected'
      or p_action = 'user.impersonated'
      or p_action like '%.deleted' or p_action like '%\_deleted' escape '\'
      or p_action like '%.deactivated'
      or p_action like '%.anonymized'
      or p_action like '%.removed'
      or p_action like '%.revoked'
      or p_action like '%.disabled'
      or p_action like '%.written\_off' escape '\'
      or p_action like '%.overridden' or p_action like '%\_overridden' escape '\'
      or p_action like '%.complained' or p_action like '%\_complained' escape '\'
      or p_action like '%.cleared' or p_action like '%\_cleared' escape '\'
      or (p_action = 'parcel.status_changed'
          and coalesce(p_detail->>'to_status', '') in ('rejected', 'returned', 'removed'))
      then 'warning'
    else 'success'
  end
$$;
