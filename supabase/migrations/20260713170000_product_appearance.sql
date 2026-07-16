-- Per-produkt udseende (white-labeling) pr. virksomhed: header-navn, -farve,
-- tema, logo og watermark. Én række pr. (company_id, product_key); ingen række
-- = systemstandard. Konfiguration er klient-agnostisk — hver klient (admin-web,
-- Android) anvender den på sit eget chrome. Manager for egen virksomhed +
-- platform-admin kan skrive. Billeder ligger i storage-bucket'en 'company-logos'
-- (RLS tillader allerede {companyId}/…), så ingen storage-migration nødvendig.
create table public.product_appearance (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  product_key text not null references public.product_catalog (key) on delete cascade,
  header_name text,
  header_color text,   -- hex '#rrggbb' eller 'linear-gradient(...)'
  theme text check (theme in ('light', 'dark')),
  logo_url text,
  watermark_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, product_key)
);

create index product_appearance_company_idx on public.product_appearance (company_id);

create trigger product_appearance_set_updated_at
  before update on public.product_appearance
  for each row execute function public.set_updated_at();

alter table public.product_appearance enable row level security;

create policy product_appearance_select on public.product_appearance
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

create policy product_appearance_write on public.product_appearance
  for all to authenticated
  using ((company_id = public.current_company_id() and public.has_role('manager')) or public.is_platform_admin())
  with check ((company_id = public.current_company_id() and public.has_role('manager')) or public.is_platform_admin());

grant select, insert, update, delete on public.product_appearance to authenticated;
