-- Secure-by-default: kræv en afsender-allowlist for e-mail-ingest som standard.
-- Ny kolonnestandard + slå den til på den eksisterende platform-række (flipper
-- false→true, hvilket udløser data_transfer.platform_changed-auditten).
alter table public.platform_settings
  alter column email_allowlist_required set default true;

update public.platform_settings
  set email_allowlist_required = true
  where email_allowlist_required = false;
