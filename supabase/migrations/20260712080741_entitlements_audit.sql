-- Revisionslog for produkt-/funktionstildelinger: tildelt, frataget og
-- udløbsdato sat/ændret. Hændelserne bærer virksomhedens id, så de også kan
-- ses af virksomheden selv via audit_log's RLS. Kataloget slås op til et
-- læsbart navn i summary; detail bærer nøglen og udløbet.
create or replace function public.audit_company_products()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  label text;
begin
  if tg_op = 'DELETE' then
    select name into label from public.product_catalog where key = old.product_key;
    perform public.record_audit(old.company_id, 'product.revoked', 'company_product',
      old.product_key, coalesce(label, old.product_key));
    return old;
  elsif tg_op = 'INSERT' then
    select name into label from public.product_catalog where key = new.product_key;
    perform public.record_audit(new.company_id, 'product.granted', 'company_product',
      new.product_key, coalesce(label, new.product_key),
      jsonb_build_object('valid_until', new.valid_until));
    return new;
  else
    if new.valid_until is distinct from old.valid_until then
      select name into label from public.product_catalog where key = new.product_key;
      perform public.record_audit(new.company_id, 'product.expiry_changed', 'company_product',
        new.product_key, coalesce(label, new.product_key),
        jsonb_build_object('from', old.valid_until, 'to', new.valid_until));
    end if;
    return new;
  end if;
end;
$$;

create or replace function public.audit_company_features()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  label text;
begin
  if tg_op = 'DELETE' then
    select name into label from public.feature_catalog where key = old.feature_key;
    perform public.record_audit(old.company_id, 'feature.revoked', 'company_feature',
      old.feature_key, coalesce(label, old.feature_key));
    return old;
  elsif tg_op = 'INSERT' then
    select name into label from public.feature_catalog where key = new.feature_key;
    perform public.record_audit(new.company_id, 'feature.granted', 'company_feature',
      new.feature_key, coalesce(label, new.feature_key),
      jsonb_build_object('valid_until', new.valid_until));
    return new;
  else
    if new.valid_until is distinct from old.valid_until then
      select name into label from public.feature_catalog where key = new.feature_key;
      perform public.record_audit(new.company_id, 'feature.expiry_changed', 'company_feature',
        new.feature_key, coalesce(label, new.feature_key),
        jsonb_build_object('from', old.valid_until, 'to', new.valid_until));
    end if;
    return new;
  end if;
end;
$$;

create trigger audit_company_products_trg
  after insert or update or delete on public.company_products
  for each row execute function public.audit_company_products();

create trigger audit_company_features_trg
  after insert or update or delete on public.company_features
  for each row execute function public.audit_company_features();
