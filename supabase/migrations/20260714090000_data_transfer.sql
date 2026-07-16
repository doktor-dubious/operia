-- Dataoverførsel (Flow 0-ingest): CSV kan komme til Operia via SFTP eller
-- automatisk e-mail. To niveauer:
--   1) Platform (DCA): hvilke kanaler platformen UDBYDER + deres fælles adresser
--      (SFTP-vært, e-mail-basisdomæne). Kunder kan kun slå udbudte kanaler til.
--   2) Pr. virksomhed: hvilke kanaler kunden har slået TIL (kunde-redigerbart) +
--      credentials (SFTP-brugernavn/-adgangskode, e-mail-navn) som KUN
--      platform-admins kan sætte — derfor i en separat tabel.

-- --- 1) Platform-globale indstillinger ------------------------------------
alter table public.platform_settings
  add column sftp_enabled boolean not null default false,
  add column sftp_host text,
  add column email_enabled boolean not null default false,
  add column email_base_domain text;

-- --- 2a) Pr. virksomhed: til/fra (kunde-redigerbart) ----------------------
create table public.company_data_transfer (
  company_id uuid primary key references public.companies (id) on delete cascade,
  sftp_enabled boolean not null default false,
  email_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger company_data_transfer_set_updated_at
  before update on public.company_data_transfer
  for each row execute function public.set_updated_at();

alter table public.company_data_transfer enable row level security;

create policy company_data_transfer_select on public.company_data_transfer
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

create policy company_data_transfer_write on public.company_data_transfer
  for all to authenticated
  using ((company_id = public.current_company_id() and public.has_role('manager')) or public.is_platform_admin())
  with check ((company_id = public.current_company_id() and public.has_role('manager')) or public.is_platform_admin());

grant select, insert, update, delete on public.company_data_transfer to authenticated;

-- --- 2b) Pr. virksomhed: credentials (KUN platform-admin) -----------------
-- Adskilt tabel, fordi RLS er række- (ikke kolonne-) baseret: kunder må se/ændre
-- til/fra ovenfor, men aldrig se credentials. sftp_password gemmes, men afsløres
-- aldrig til browseren — klienten læser kun det genererede 'sftp_password_set'.
-- Gateway'en (SFTPGo) læser tabellen med service-role (uden om RLS).
create table public.company_data_transfer_secret (
  company_id uuid primary key references public.companies (id) on delete cascade,
  sftp_username text,
  sftp_password text,
  sftp_password_set boolean generated always as
    (sftp_password is not null and sftp_password <> '') stored,
  email_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger company_data_transfer_secret_set_updated_at
  before update on public.company_data_transfer_secret
  for each row execute function public.set_updated_at();

alter table public.company_data_transfer_secret enable row level security;

create policy company_data_transfer_secret_select on public.company_data_transfer_secret
  for select to authenticated using (public.is_platform_admin());

create policy company_data_transfer_secret_write on public.company_data_transfer_secret
  for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

grant select, insert, update, delete on public.company_data_transfer_secret to authenticated;

-- --- Audit (NIS2) ---------------------------------------------------------
create or replace function public.audit_company_data_transfer()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.record_audit(new.company_id, 'data_transfer.updated', 'data_transfer',
    new.company_id::text, null,
    jsonb_build_object('sftp', new.sftp_enabled, 'email', new.email_enabled));
  return new;
end;
$$;

create trigger audit_company_data_transfer_trg
  after insert or update on public.company_data_transfer
  for each row execute function public.audit_company_data_transfer();

-- Log ændring af credentials uden at logge selve værdierne.
create or replace function public.audit_company_data_transfer_secret()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.record_audit(new.company_id, 'data_transfer.credentials_updated', 'data_transfer',
    new.company_id::text, null,
    jsonb_build_object('sftp_user', nullif(new.sftp_username, '') is not null,
                       'sftp_pw', new.sftp_password_set,
                       'email_name', nullif(new.email_name, '') is not null));
  return new;
end;
$$;

create trigger audit_company_data_transfer_secret_trg
  after insert or update on public.company_data_transfer_secret
  for each row execute function public.audit_company_data_transfer_secret();

-- Platform-globale ændringer (til/fra + adresser).
create or replace function public.audit_platform_data_transfer()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.sftp_enabled is distinct from old.sftp_enabled
     or new.sftp_host is distinct from old.sftp_host
     or new.email_enabled is distinct from old.email_enabled
     or new.email_base_domain is distinct from old.email_base_domain then
    perform public.record_audit(null, 'data_transfer.platform_changed', 'platform_settings', 'platform', null,
      jsonb_build_object('sftp_enabled', new.sftp_enabled, 'sftp_host', new.sftp_host,
                         'email_enabled', new.email_enabled, 'email_base_domain', new.email_base_domain));
  end if;
  return new;
end;
$$;

create trigger audit_platform_data_transfer_trg
  after update on public.platform_settings
  for each row execute function public.audit_platform_data_transfer();

-- --- Logs-kategorisering: data_transfer.* hører under 'imports' ------------
create or replace function public.audit_category(p_action text)
returns text language sql immutable as $$
  select case split_part(coalesce(p_action, ''), '.', 1)
    when 'parcel'         then 'parcels'
    when 'parcel_flow'    then 'parcels'
    when 'employee'       then 'directory'
    when 'department'     then 'directory'
    when 'location'       then 'config'
    when 'handling_class' then 'config'
    when 'carrier'        then 'config'
    when 'shipping'       then 'shipping'
    when 'agreement'      then 'shipping'
    when 'asset'          then 'assets'
    when 'asset_category' then 'assets'
    when 'asset_location' then 'assets'
    when 'assets'         then 'assets'
    when 'inventory_item' then 'inventory'
    when 'locker'         then 'lockers'
    when 'user'           then 'access'
    when 'product'        then 'entitlements'
    when 'feature'        then 'entitlements'
    when 'template'       then 'branding'
    when 'language'       then 'branding'
    when 'currency'       then 'branding'
    when 'appearance'     then 'branding'
    when 'product_text'   then 'branding'
    when 'maps'           then 'maps'
    when 'route'          then 'maps'
    when 'import'         then 'imports'
    when 'import_config'  then 'imports'
    when 'data_transfer'  then 'imports'
    else 'other'
  end
$$;
