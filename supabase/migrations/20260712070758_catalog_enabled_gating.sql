-- Produkter & funktioner flytter til konfigurationssiderne:
--  - Operia → Produkter & funktioner: platformens udbud (enabled-flag på
--    katalogerne — fravalgte skjules for kunderne og lukkes i gatingen).
--  - Konfigurér → Produkter & funktioner: kundens tildelinger m. udløbsdato.
-- has_product/has_feature respekterer nu også katalog-flaget; udløbsdatoen
-- var allerede håndteret (valid_until >= current_date).

alter table public.product_catalog add column enabled boolean not null default true;
alter table public.feature_catalog add column enabled boolean not null default true;

create or replace function public.has_product(p text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin() or exists (
    select 1
    from public.company_products cp
    join public.product_catalog pc on pc.key = cp.product_key
    where cp.company_id = public.current_company_id()
      and cp.product_key = p
      and pc.enabled
      and (cp.valid_until is null or cp.valid_until >= current_date)
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
    select 1
    from public.company_features cf
    join public.feature_catalog fc on fc.key = cf.feature_key
    where cf.company_id = public.current_company_id()
      and cf.feature_key = f
      and fc.enabled
      and (cf.valid_until is null or cf.valid_until >= current_date)
  );
$$;
