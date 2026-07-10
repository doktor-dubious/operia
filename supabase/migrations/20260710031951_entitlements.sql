-- Two-level entitlements: products (whole systems) and features (add-ons),
-- both granted per company with optional expiry. UI nav and screens gate on these.

create table public.product_catalog (
  key text primary key,
  name text not null,
  description text,
  sort_order int not null default 0
);

create table public.feature_catalog (
  key text primary key,
  product_key text not null references public.product_catalog (key) on delete cascade,
  name text not null,
  description text
);

create table public.company_products (
  company_id uuid not null references public.companies (id) on delete cascade,
  product_key text not null references public.product_catalog (key) on delete cascade,
  valid_until date, -- null = uden udløb
  created_at timestamptz not null default now(),
  primary key (company_id, product_key)
);

create table public.company_features (
  company_id uuid not null references public.companies (id) on delete cascade,
  feature_key text not null references public.feature_catalog (key) on delete cascade,
  valid_until date,
  created_at timestamptz not null default now(),
  primary key (company_id, feature_key)
);

-- ---------------------------------------------------------------------------
-- Helpers (bruges i RLS og af UI via rpc)
-- ---------------------------------------------------------------------------
create or replace function public.has_product(p text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin() or exists (
    select 1 from public.company_products
    where company_id = public.current_company_id()
      and product_key = p
      and (valid_until is null or valid_until >= current_date)
  );
$$;

create or replace function public.has_feature(f text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin() or exists (
    select 1 from public.company_features
    where company_id = public.current_company_id()
      and feature_key = f
      and (valid_until is null or valid_until >= current_date)
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS: kataloger er læsbare for alle loggede ind; tildelinger ses af egen
-- virksomhed og administreres kun af platform-admins.
-- ---------------------------------------------------------------------------
alter table public.product_catalog enable row level security;
alter table public.feature_catalog enable row level security;
alter table public.company_products enable row level security;
alter table public.company_features enable row level security;

create policy product_catalog_select on public.product_catalog
  for select to authenticated using (true);

create policy product_catalog_write on public.product_catalog
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy feature_catalog_select on public.feature_catalog
  for select to authenticated using (true);

create policy feature_catalog_write on public.feature_catalog
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy company_products_select on public.company_products
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

create policy company_products_write on public.company_products
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy company_features_select on public.company_features
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

create policy company_features_write on public.company_features
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- Katalog-seed (globale data, ikke tenant-data). Pakker er kerneproduktet;
-- resten er add-on-produkter fra prototypens scope.
-- ---------------------------------------------------------------------------
insert into public.product_catalog (key, name, description, sort_order) values
  ('parcels',  'Pakker',            'Track & trace for interne pakker (kerneprodukt)', 10),
  ('assets',   'Aktiver',           'Aktiv- og lagerstyring',                          20),
  ('lockers',  'Smarte skabe',      'Udlevering via smart lockers',                    30),
  ('iot',      'IoT-sensorer',      'Sensordata og alarmer',                           40),
  ('shipping', 'Forsendelse',       'Udgående forsendelser via carriers',              50),
  ('routes',   'Ruteplanlægning',   'Interne distributionsruter',                      60),
  ('booking',  'Lokalebooking',     'Mødelokaler og fakturering',                      70);

insert into public.feature_catalog (key, product_key, name, description) values
  ('reminders',   'parcels', 'Påmindelser',        'Automatiske påmindelser om uafhentede pakker'),
  ('signature',   'parcels', 'Underskrift',        'Underskrift på skærm ved udlevering'),
  ('photo',       'parcels', 'Tilstandsfoto',      'Foto af pakkens tilstand ved modtagelse'),
  ('label_print', 'parcels', 'Labelprint',         'Print af interne labels'),
  ('nfc_handover','parcels', 'NFC-udlevering',     'Identitet via NFC/MIFARE-kort ved udlevering');

grant select, insert, update, delete on public.product_catalog, public.feature_catalog,
  public.company_products, public.company_features to authenticated;
