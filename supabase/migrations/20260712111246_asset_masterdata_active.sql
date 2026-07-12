-- Aktiv-kategorier og -placeringer er app-ejet stamdata (som pakkernes
-- placeringer): managers CRUD'er dem frit med aktiv/inaktiv i stedet for
-- sletning som standard. Revisionslog som de øvrige stamdata-tabeller.
alter table public.asset_categories add column is_active boolean not null default true;
alter table public.asset_locations add column is_active boolean not null default true;

create or replace function public.audit_asset_categories()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit(new.company_id, 'asset_category.created', 'asset_category', new.id::text, new.name);
    return new;
  elsif tg_op = 'UPDATE' then
    if old.is_active and not new.is_active then
      perform public.record_audit(new.company_id, 'asset_category.deactivated', 'asset_category', new.id::text, new.name);
    end if;
    return new;
  else
    perform public.record_audit(old.company_id, 'asset_category.deleted', 'asset_category', old.id::text, old.name);
    return old;
  end if;
end;
$$;

create or replace function public.audit_asset_locations()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit(new.company_id, 'asset_location.created', 'asset_location', new.id::text, new.name);
    return new;
  elsif tg_op = 'UPDATE' then
    if old.is_active and not new.is_active then
      perform public.record_audit(new.company_id, 'asset_location.deactivated', 'asset_location', new.id::text, new.name);
    end if;
    return new;
  else
    perform public.record_audit(old.company_id, 'asset_location.deleted', 'asset_location', old.id::text, old.name);
    return old;
  end if;
end;
$$;

create trigger audit_asset_categories_trg
  after insert or update or delete on public.asset_categories
  for each row execute function public.audit_asset_categories();

create trigger audit_asset_locations_trg
  after insert or update or delete on public.asset_locations
  for each row execute function public.audit_asset_locations();
