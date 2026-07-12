-- Revisionslog for platformens produkt-/funktionskatalog (Operia →
-- Produkter & funktioner): til-/fravalg af hvad platformen udbyder.
-- Platform-hændelser (company_id null) — kun synlige for platform-admins.
create or replace function public.audit_product_catalog()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.enabled is distinct from old.enabled then
    perform public.record_audit(null,
      case when new.enabled then 'product.enabled' else 'product.disabled' end,
      'product_catalog', new.key, new.name);
  end if;
  return new;
end;
$$;

create or replace function public.audit_feature_catalog()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.enabled is distinct from old.enabled then
    perform public.record_audit(null,
      case when new.enabled then 'feature.enabled' else 'feature.disabled' end,
      'feature_catalog', new.key, new.name);
  end if;
  return new;
end;
$$;

create trigger audit_product_catalog_trg
  after update on public.product_catalog
  for each row execute function public.audit_product_catalog();

create trigger audit_feature_catalog_trg
  after update on public.feature_catalog
  for each row execute function public.audit_feature_catalog();
