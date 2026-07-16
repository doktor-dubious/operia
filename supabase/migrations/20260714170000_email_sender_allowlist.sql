-- Sikkerhed for den automatiske e-mail-ingest: en afsender-allowlist pr.
-- virksomhed. Uden den kan enhver, der kender modtageradressen, poste en
-- CSV der automatisk behandles som medarbejder-stamdata (upsert + deaktivér
-- manglende) — en data-poisoning/DoS-vektor. Med en allowlist SKAL afsenderens
-- From matche en tilladt adresse eller et @domæne (håndhæves i email-inbound).
--
-- Ligger i company_data_transfer_secret (platform-admin-styret, ligesom
-- email_name) — det er en sikkerhedskontrol, ikke en kunde-selvbetjening.
alter table public.company_data_transfer_secret
  add column email_allowed_senders text[] not null default '{}';

-- Udvid credentials-auditten så det ses HVORNÅR allowlisten ændres (kun antal,
-- aldrig adresserne selv).
create or replace function public.audit_company_data_transfer_secret()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.record_audit(new.company_id, 'data_transfer.credentials_updated', 'data_transfer',
    new.company_id::text, null,
    jsonb_build_object('sftp_user', nullif(new.sftp_username, '') is not null,
                       'sftp_pw', new.sftp_password_set,
                       'email_name', nullif(new.email_name, '') is not null,
                       'allowed_senders', coalesce(array_length(new.email_allowed_senders, 1), 0)));
  return new;
end;
$$;
