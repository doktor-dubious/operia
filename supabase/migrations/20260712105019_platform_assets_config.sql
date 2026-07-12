-- Aktiver-konfiguration på platformniveau (Operia → Aktiver):
--  - Standardudløb for skab-udlån (startværdien i «Udløb»-feltet; kan altid
--    ændres pr. udlån). null = intet udløb.
--  - Standardkategorier: platformens forslag/startsæt til nye kunder.
--    Placeringer er BEVIDST udeladt — de er kundespecifikke (kundens egne
--    bygninger/rum) og giver ingen mening som platformstandard.
-- Kundens egne kategorier/placeringer og CSV-import hører til det kommende
-- Aktiver-modul.
alter table public.platform_settings
  add column locker_loan_ttl_hours integer default 72
    check (locker_loan_ttl_hours is null or locker_loan_ttl_hours > 0);

create table public.platform_asset_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  track text not null default 'serial' check (track in ('serial', 'qty')),
  created_at timestamptz not null default now()
);

alter table public.platform_asset_categories enable row level security;

create policy platform_asset_categories_select on public.platform_asset_categories
  for select to authenticated using (true);

create policy platform_asset_categories_write on public.platform_asset_categories
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

grant select, insert, update, delete on public.platform_asset_categories to authenticated;
