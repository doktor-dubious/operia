-- Audit (NIS2) for white-labeling: udseende (Design) og tekst-overrides (Tekster),
-- plus route-redigering (edit). Alt logges server-side via SECURITY DEFINER, så en
-- klient hverken kan springe logning over eller forfalske aktør.

-- --- Udseende: én række pr. gem → én logpost -------------------------------
create or replace function public.audit_product_appearance()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.record_audit(old.company_id, 'appearance.reset', 'appearance', old.product_key, old.product_key);
    return old;
  else
    perform public.record_audit(new.company_id, 'appearance.updated', 'appearance', new.product_key, new.product_key);
    return new;
  end if;
end;
$$;

create trigger audit_product_appearance_trg
  after insert or update or delete on public.product_appearance
  for each row execute function public.audit_product_appearance();

-- --- Tekster: fuld erstatning i én transaktion + én logpost ----------------
-- Klienten kalder denne RPC i stedet for at slette/indsætte direkte, så et gem
-- giver præcis én revisionspost (ikke én pr. tekstfelt). Autorisationen spejler
-- product_text_override_write-politikken.
create or replace function public.replace_product_texts(
  p_company_id uuid,
  p_product_key text,
  p_values jsonb          -- objekt: text_key -> value (kun udfyldte felter)
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  if not ((p_company_id = public.current_company_id() and public.has_role('manager'))
          or public.is_platform_admin()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  delete from public.product_text_override
    where company_id = p_company_id and product_key = p_product_key;

  insert into public.product_text_override (company_id, product_key, text_key, value)
  select p_company_id, p_product_key, key, value
  from jsonb_each_text(coalesce(p_values, '{}'::jsonb))
  where value is not null and btrim(value) <> '';
  get diagnostics v_count = row_count;

  perform public.record_audit(p_company_id, 'product_text.updated', 'product_text', p_product_key,
    p_product_key, jsonb_build_object('count', v_count));
end;
$$;

revoke execute on function public.replace_product_texts(uuid, text, jsonb) from public, anon;
grant execute on function public.replace_product_texts(uuid, text, jsonb) to authenticated;

-- --- Ruter: log også almindelig redigering (edit), ikke kun create/delete ---
create or replace function public.audit_routes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit(new.company_id, 'route.created', 'route', new.id::text, new.name);
    return new;
  elsif tg_op = 'UPDATE' then
    if old.is_active and not new.is_active then
      perform public.record_audit(new.company_id, 'route.deactivated', 'route', new.id::text, new.name);
    elsif not old.is_active and new.is_active then
      perform public.record_audit(new.company_id, 'route.reactivated', 'route', new.id::text, new.name);
    else
      perform public.record_audit(new.company_id, 'route.updated', 'route', new.id::text, new.name);
    end if;
    return new;
  else
    perform public.record_audit(old.company_id, 'route.deleted', 'route', old.id::text, old.name);
    return old;
  end if;
end;
$$;

-- --- Logs-kategorisering: udseende + tekster hører under 'branding' ---------
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
    else 'other'
  end
$$;
