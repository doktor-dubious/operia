-- DCA's egne forsendelsesaftaler (Operia → Fragtfirmaer, fra prototypens
-- "own shipping agreements"): aggregator-konti og direkte fragtfirma-aftaler
-- som marginmodellen booker på. Platform-niveau (ingen company_id) og kun
-- for platform-admins.
--
-- Nøglen er skriv-kun: kolonne-grants udelader api_key fra select, så
-- klienten kan sætte/udskifte den men aldrig læse den tilbage. has_key
-- (genereret) driver "nøgle sat"-visningen.
create table public.carrier_agreements (
  id uuid primary key default gen_random_uuid(),
  agreement_type text not null check (agreement_type in ('aggregator', 'carrier')),
  provider text not null check (provider in ('webshipper', 'sendcloud', 'coolrunner', 'shipbook', 'other')),
  name text,
  api_user text,
  account_no text,
  api_key text,
  has_key boolean generated always as (api_key is not null) stored,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger carrier_agreements_set_updated_at
  before update on public.carrier_agreements
  for each row execute function public.set_updated_at();

alter table public.carrier_agreements enable row level security;

create policy carrier_agreements_all on public.carrier_agreements
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- Kolonne-grants: alt undtagen api_key kan læses; api_key kan kun skrives.
grant select (id, agreement_type, provider, name, api_user, account_no, has_key, is_active, created_at, updated_at)
  on public.carrier_agreements to authenticated;
grant insert (agreement_type, provider, name, api_user, account_no, api_key, is_active)
  on public.carrier_agreements to authenticated;
grant update (name, api_user, account_no, api_key, is_active)
  on public.carrier_agreements to authenticated;
grant delete on public.carrier_agreements to authenticated;
