-- Revisionslog for Operia → Aktiver (platformens standarder):
--  - standardudløb for skab-udlån (from/til i detail)
--  - standardkategorier (oprettet/slettet)
-- Kundernes aktiver/kategorier/placeringer er allerede dækket af
-- audit_assets/audit_asset_categories/audit_asset_locations-triggerne.
create or replace function public.audit_platform_assets_config()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.locker_loan_ttl_hours is distinct from old.locker_loan_ttl_hours then
    perform public.record_audit(null, 'assets.locker_ttl_changed', 'platform_settings', 'platform',
      null, jsonb_build_object('from', old.locker_loan_ttl_hours, 'to', new.locker_loan_ttl_hours));
  end if;
  return new;
end;
$$;

create or replace function public.audit_platform_asset_categories()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit(null, 'asset_category_default.created', 'platform_asset_category',
      new.id::text, new.name, jsonb_build_object('track', new.track));
    return new;
  else
    perform public.record_audit(null, 'asset_category_default.deleted', 'platform_asset_category',
      old.id::text, old.name);
    return old;
  end if;
end;
$$;

create trigger audit_platform_assets_config_trg
  after update on public.platform_settings
  for each row execute function public.audit_platform_assets_config();

create trigger audit_platform_asset_categories_trg
  after insert or delete on public.platform_asset_categories
  for each row execute function public.audit_platform_asset_categories();
