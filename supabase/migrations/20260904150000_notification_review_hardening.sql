-- Hærdning efter code review af Teams/Slack-kanalerne (2026-09-04).
--
-- 1) platform_settings.slack_enabled auditeres som entra_enabled/ai_enabled.
-- 2) Slack må kun slå modtagere op på e-mail når kunden har slået det til.
-- 3) 'parcel.notifications_deferred' (dispatcherens spor efter forbigående
--    udfald hos udbyderen) vises som advarsel i Logs.

-- ── 1) Audit af platformens Slack-udbud ─────────────────────────────────────
-- Samme mønster som audit_platform_entra / audit_platform_ai: en ren
-- PostgREST-opdatering fra /operia/integrationer skriver ellers intet spor.
create or replace function public.audit_platform_slack()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.slack_enabled is distinct from old.slack_enabled then
    perform public.record_audit(null, 'slack.platform_changed', 'platform_settings', 'platform', null,
      jsonb_build_object('enabled', new.slack_enabled));
  end if;
  return new;
end;
$$;

drop trigger if exists audit_platform_slack_trg on public.platform_settings;
create trigger audit_platform_slack_trg
  after update on public.platform_settings
  for each row execute function public.audit_platform_slack();

-- ── 2) Opslag på e-mail er et tilvalg pr. kunde ─────────────────────────────
-- Uden spærringen forsøges Slack-kanalen for HVER medarbejder med en e-mail.
-- Hos en kunde hvor kun få har Slack, giver det et rate-limitet opslag
-- (users.lookupByEmail, Tier 2) plus en 'failed'-række og en fejl i Logs pr.
-- forsøg for alle de øvrige. Kunder der allerede har forbundet Slack, har
-- gjort det med e-mail-opslaget som eneste adressering, så de beholder det.
alter table public.companies
  add column slack_lookup_by_email boolean not null default false;

comment on column public.companies.slack_lookup_by_email is
  'Slack: må modtagere uden employees.slack_user_id slås op i workspacet på deres e-mail? Læses af _shared/channels.ts (recipientFor).';

update public.companies c
   set slack_lookup_by_email = true
  from public.company_slack_config s
 where s.company_id = c.id and s.token_set;

-- Skiftet auditeres: audit_company_billing_settings (20260903150100)
-- sammenligner faste kolonner; her tilføjes en lille selvstændig trigger frem
-- for at genskrive den.
create or replace function public.audit_company_slack_lookup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.slack_lookup_by_email is distinct from old.slack_lookup_by_email then
    perform public.record_audit(new.id, 'company.slack_lookup_changed', 'company', new.id::text, new.name,
      jsonb_build_object('from', old.slack_lookup_by_email, 'to', new.slack_lookup_by_email));
  end if;
  return new;
end;
$$;

drop trigger if exists audit_company_slack_lookup_trg on public.companies;
create trigger audit_company_slack_lookup_trg
  after update on public.companies
  for each row execute function public.audit_company_slack_lookup();

-- ── 3) Udskydelser er en advarsel ───────────────────────────────────────────
-- Basis er 20260814200000 (inkl. parameter-default — den må ikke fjernes, ellers
-- afviser Postgres CREATE OR REPLACE). Klientspejlet er levelOf i
-- web/src/routes/_app/operia.logs.tsx — holdt i sync.
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
      or p_action like '%\_deferred' escape '\'
      or (p_action = 'parcel.status_changed'
          and coalesce(p_detail->>'to_status', '') in ('rejected', 'returned', 'removed'))
      then 'warning'
    else 'success'
  end
$$;
