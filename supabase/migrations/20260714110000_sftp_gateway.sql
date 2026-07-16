-- SFTP-gateway (SFTPGo på ftp.predictioninstitute.com): Operia er kilde-til-
-- sandhed for login. SFTPGo kalder sftp-auth-hook'en, som verificerer mod disse
-- data og peger brugeren på Supabase Storage (S3) med et pr.-virksomhed-prefix.
-- Uploads meldes tilbage via sftp-uploaded → inbound_files.

-- Brugernavn/e-mail-navn skal være globalt unikke, så hook'en entydigt kan
-- afbilde login/adresse → virksomhed.
create unique index company_data_transfer_secret_username_key
  on public.company_data_transfer_secret (sftp_username)
  where sftp_username is not null;
create unique index company_data_transfer_secret_email_name_key
  on public.company_data_transfer_secret (email_name)
  where email_name is not null;

-- Privat bucket til indkommende filer. Kun gateway'en (S3-nøgler) og
-- Edge Functions (service-role) tilgår den — ingen storage-RLS for app-brugere.
insert into storage.buckets (id, name, public)
values ('imports', 'imports', false)
on conflict (id) do nothing;

-- Kvitteringslog for modtagne filer (SFTP nu, e-mail senere). Skrives af
-- sftp-uploaded (service-role); læses af egen virksomhed + platform-admins.
create table public.inbound_files (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  source text not null check (source in ('sftp', 'email')),
  object_path text not null,
  file_name text,
  file_size bigint,
  status text not null default 'received' check (status in ('received', 'processed', 'rejected', 'failed')),
  import_run_id uuid references public.import_runs (id) on delete set null,
  received_at timestamptz not null default now()
);

create index inbound_files_company_idx on public.inbound_files (company_id, received_at desc);

alter table public.inbound_files enable row level security;

create policy inbound_files_select on public.inbound_files
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

-- Kun læsning for klienter; skrivning sker via service-role i sftp-uploaded.
grant select on public.inbound_files to authenticated;
revoke insert, update, delete on public.inbound_files from anon, authenticated;

-- Audit: log hver modtaget fil (SECURITY DEFINER-trigger, som de øvrige).
create or replace function public.audit_inbound_files()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.record_audit(new.company_id, 'data_transfer.received', 'data_transfer',
    new.company_id::text, new.file_name,
    jsonb_build_object('source', new.source, 'path', new.object_path, 'size', new.file_size));
  return new;
end;
$$;

create trigger audit_inbound_files_trg
  after insert on public.inbound_files
  for each row execute function public.audit_inbound_files();

-- Login-opslag til SFTP-gateway'en: verificér brugernavn + adgangskode (bcrypt)
-- og returnér virksomheden, forudsat at både platform og virksomhed har SFTP
-- slået til. Kun service-role må kalde den (SFTPGo via sftp-auth-hook'en).
create or replace function public.sftp_auth_lookup(p_username text, p_password text)
returns table (company_id uuid)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return query
  select s.company_id
  from public.company_data_transfer_secret s
  join public.company_data_transfer c on c.company_id = s.company_id
  cross join public.platform_settings ps
  where s.sftp_username = p_username
    and s.sftp_password is not null
    and s.sftp_password = crypt(p_password, s.sftp_password)
    and c.sftp_enabled
    and ps.sftp_enabled;
end;
$$;

revoke execute on function public.sftp_auth_lookup(text, text) from public, anon, authenticated;
grant execute on function public.sftp_auth_lookup(text, text) to service_role;
