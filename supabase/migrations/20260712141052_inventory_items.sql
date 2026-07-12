-- Lagervarer (Lager-produktet): antalsbaserede forbrugsvarer med
-- genbestillingspunkt og "på bestilling" (indkøbsordre-flowet). Ejes af
-- importen som aktiverne: appen opretter/redigerer ikke varer manuelt —
-- kun deaktivering og platform-admin-sletning. Kategorier/placeringer
-- deles med aktivregisteret (asset_categories med track='qty').
create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  sku text,
  name text not null,
  category_id uuid references public.asset_categories (id) on delete set null,
  location_id uuid references public.asset_locations (id) on delete set null,
  quantity numeric not null default 0,
  reorder_point numeric,
  unit text,
  unit_cost numeric,
  on_order numeric not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, sku)
);

alter table public.inventory_items enable row level security;

create policy inventory_items_select on public.inventory_items
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

create policy inventory_items_write on public.inventory_items
  for all to authenticated
  using ((company_id = public.current_company_id() and public.has_role('manager')) or public.is_platform_admin())
  with check ((company_id = public.current_company_id() and public.has_role('manager')) or public.is_platform_admin());

grant select, insert, update, delete on public.inventory_items to authenticated;

create or replace function public.audit_inventory_items()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit(new.company_id, 'inventory_item.created', 'inventory_item', new.id::text,
      coalesce(new.name, new.sku));
    return new;
  elsif tg_op = 'UPDATE' then
    if old.is_active and not new.is_active then
      perform public.record_audit(new.company_id, 'inventory_item.deactivated', 'inventory_item', new.id::text,
        coalesce(new.name, new.sku));
    end if;
    return new;
  else
    perform public.record_audit(old.company_id, 'inventory_item.deleted', 'inventory_item', old.id::text,
      coalesce(old.name, old.sku));
    return old;
  end if;
end;
$$;

create trigger audit_inventory_items_trg
  after insert or update or delete on public.inventory_items
  for each row execute function public.audit_inventory_items();
