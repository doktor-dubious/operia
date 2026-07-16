-- Planlagt import (Flow 0): kør kun importen på et fast klokkeslæt i stedet for
-- løbende. To niveauer som resten af dataoverførslen:
--   1) Platform: standard-klokkeslæt for alle kunder.
--   2) Pr. virksomhed: kundens eget klokkeslæt (overstyrer platformens).
-- Klokkeslættet er lokal tid uden dato (time). Selve kørslen håndteres af
-- ingest-pipelinen uden for Supabase; her gemmes blot planen.

alter table public.platform_settings
  add column import_schedule_enabled boolean not null default false,
  add column import_schedule_time time;

alter table public.company_data_transfer
  add column import_schedule_enabled boolean not null default false,
  add column import_schedule_time time;

-- Udvid revisions-triggerne så plan-ændringer også logges (NIS2).
create or replace function public.audit_company_data_transfer()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.record_audit(new.company_id, 'data_transfer.updated', 'data_transfer',
    new.company_id::text, null,
    jsonb_build_object('sftp', new.sftp_enabled, 'email', new.email_enabled,
                       'schedule', new.import_schedule_enabled,
                       'schedule_time', new.import_schedule_time));
  return new;
end;
$$;

create or replace function public.audit_platform_data_transfer()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.sftp_enabled is distinct from old.sftp_enabled
     or new.sftp_host is distinct from old.sftp_host
     or new.email_enabled is distinct from old.email_enabled
     or new.email_base_domain is distinct from old.email_base_domain
     or new.import_schedule_enabled is distinct from old.import_schedule_enabled
     or new.import_schedule_time is distinct from old.import_schedule_time then
    perform public.record_audit(null, 'data_transfer.platform_changed', 'platform_settings', 'platform', null,
      jsonb_build_object('sftp_enabled', new.sftp_enabled, 'sftp_host', new.sftp_host,
                         'email_enabled', new.email_enabled, 'email_base_domain', new.email_base_domain,
                         'import_schedule_enabled', new.import_schedule_enabled,
                         'import_schedule_time', new.import_schedule_time));
  end if;
  return new;
end;
$$;
