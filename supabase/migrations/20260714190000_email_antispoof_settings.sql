-- Platform-globale sikkerhedskontakter for e-mail-ingest (Operia →
-- Dataoverførsel). Tre knapper der styrer email-inbound's afsenderforsvar:
--   email_antispoof_enabled  : kør DKIM/SPF/DMARC-verifikationen (anbefalet)
--   email_antispoof_strict   : konservativ — afvis også softfail/none DMARC
--   email_allowlist_required : afvis når en virksomheds allowlist er tom
--                              (secure-by-default; ellers = ingen begrænsning)
alter table public.platform_settings
  add column email_antispoof_enabled  boolean not null default true,
  add column email_antispoof_strict   boolean not null default false,
  add column email_allowlist_required boolean not null default false;

-- Medtag de nye felter i platform-auditten (NIS2 — ændringer skal spores).
create or replace function public.audit_platform_data_transfer()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.sftp_enabled is distinct from old.sftp_enabled
     or new.sftp_host is distinct from old.sftp_host
     or new.email_enabled is distinct from old.email_enabled
     or new.email_base_domain is distinct from old.email_base_domain
     or new.email_antispoof_enabled is distinct from old.email_antispoof_enabled
     or new.email_antispoof_strict is distinct from old.email_antispoof_strict
     or new.email_allowlist_required is distinct from old.email_allowlist_required then
    perform public.record_audit(null, 'data_transfer.platform_changed', 'platform_settings', 'platform', null,
      jsonb_build_object('sftp_enabled', new.sftp_enabled, 'sftp_host', new.sftp_host,
                         'email_enabled', new.email_enabled, 'email_base_domain', new.email_base_domain,
                         'antispoof', new.email_antispoof_enabled,
                         'antispoof_strict', new.email_antispoof_strict,
                         'allowlist_required', new.email_allowlist_required));
  end if;
  return new;
end;
$$;
