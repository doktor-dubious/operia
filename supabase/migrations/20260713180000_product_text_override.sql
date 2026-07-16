-- Per-tenant tekst-overrides (app_labels-konceptet fra CLAUDE.md): kundespecifikke
-- labels der lægges oven på produktets standardtekster ved opslag — aldrig skrevet
-- ind i i18n-filerne. Én række pr. (company_id, product_key, text_key); ingen række
-- = brug standardteksten. text_key er en stabil slug defineret i klientens
-- tekst-katalog (web/src/lib/product-texts.ts). Manager for egen virksomhed +
-- platform-admin kan skrive — samme mønster som product_appearance.
create table public.product_text_override (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  product_key text not null references public.product_catalog (key) on delete cascade,
  text_key text not null,
  value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, product_key, text_key)
);

create index product_text_override_company_idx
  on public.product_text_override (company_id, product_key);

create trigger product_text_override_set_updated_at
  before update on public.product_text_override
  for each row execute function public.set_updated_at();

alter table public.product_text_override enable row level security;

create policy product_text_override_select on public.product_text_override
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

create policy product_text_override_write on public.product_text_override
  for all to authenticated
  using ((company_id = public.current_company_id() and public.has_role('manager')) or public.is_platform_admin())
  with check ((company_id = public.current_company_id() and public.has_role('manager')) or public.is_platform_admin());

grant select, insert, update, delete on public.product_text_override to authenticated;
