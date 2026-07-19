-- Rollemodel v2, del 2: RLS-politikker og gate-funktioner udvides til de nye
-- roller. Princippet er uændret: manager kan alt hos egen kunde,
-- platform-admin alt overalt; de nye roller åbner deres eget domæne.
-- Web-navigationen er kun UX — håndhævelsen er disse politikker (CLAUDE.md).

-- Fælles hjælper: har brugeren mindst én af rollerne? Én subquery i stedet
-- for en kæde af has_role()-kald i hver politik.
create or replace function public.has_any_role(variadic p_roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = (select auth.uid()) and role = any (p_roles)
  );
$$;

revoke execute on function public.has_any_role(variadic public.app_role[]) from public, anon;
grant execute on function public.has_any_role(variadic public.app_role[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Datakopiering: hidtidige parcel_handlers ER håndterminal-brugere (rollen
-- skifter betydning til web-pakkehåndterer). De beholder parcel_handler og
-- får håndterminal-rollerne, så terminalens adgang (modtag/udlevér + hh_stock)
-- er uændret.
insert into public.user_roles (user_id, role)
select user_id, r
from public.user_roles
cross join lateral (values
  ('handheld_parcel_handler'::public.app_role),
  ('handheld_inventory_handler'::public.app_role)
) as v(r)
where role = 'parcel_handler'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Pakker: pakkehåndterer (web), pakke-manager og håndterminal-pakkehåndterer
-- kan registrere/opdatere pakker.
drop policy parcels_insert on public.parcels;
create policy parcels_insert on public.parcels
  for insert to authenticated
  with check (
    (
      company_id = public.current_company_id()
      and public.has_any_role('manager', 'parcel_manager', 'parcel_handler', 'handheld_parcel_handler')
    )
    or public.is_platform_admin()
  );

drop policy parcels_update on public.parcels;
create policy parcels_update on public.parcels
  for update to authenticated
  using (
    (
      company_id = public.current_company_id()
      and public.has_any_role('manager', 'parcel_manager', 'parcel_handler', 'handheld_parcel_handler')
    )
    or public.is_platform_admin()
  )
  with check (
    company_id = public.current_company_id() or public.is_platform_admin()
  );

-- ---------------------------------------------------------------------------
-- Stamdata (Master Data-sektionen): data_manager sidestilles med manager på
-- medarbejdere, afdelinger og skabe.
drop policy departments_write on public.departments;
create policy departments_write on public.departments
  for all to authenticated
  using (
    (company_id = public.current_company_id() and public.has_any_role('manager', 'data_manager'))
    or public.is_platform_admin()
  )
  with check (
    (company_id = public.current_company_id() and public.has_any_role('manager', 'data_manager'))
    or public.is_platform_admin()
  );

drop policy employees_write on public.employees;
create policy employees_write on public.employees
  for all to authenticated
  using (
    (company_id = public.current_company_id() and public.has_any_role('manager', 'data_manager'))
    or public.is_platform_admin()
  )
  with check (
    (company_id = public.current_company_id() and public.has_any_role('manager', 'data_manager'))
    or public.is_platform_admin()
  );

drop policy lockers_write on public.lockers;
create policy lockers_write on public.lockers
  for all to authenticated
  using (
    (company_id = public.current_company_id() and public.has_any_role('manager', 'data_manager'))
    or public.is_platform_admin()
  )
  with check (
    (company_id = public.current_company_id() and public.has_any_role('manager', 'data_manager'))
    or public.is_platform_admin()
  );

-- Import/eksport bruges fra Master Data (data_manager) og fra import-siderne
-- under Aktiver og Lager (asset_manager/inventory_manager).
drop policy import_runs_select on public.import_runs;
create policy import_runs_select on public.import_runs
  for select to authenticated
  using (
    (
      company_id = public.current_company_id()
      and public.has_any_role('manager', 'data_manager', 'asset_manager', 'inventory_manager')
    )
    or public.is_platform_admin()
  );

drop policy import_runs_insert on public.import_runs;
create policy import_runs_insert on public.import_runs
  for insert to authenticated
  with check (
    (
      company_id = public.current_company_id()
      and public.has_any_role('manager', 'data_manager', 'asset_manager', 'inventory_manager')
    )
    or public.is_platform_admin()
  );

drop policy import_configs_write on public.import_configs;
create policy import_configs_write on public.import_configs
  for all to authenticated
  using (
    (
      company_id = public.current_company_id()
      and public.has_any_role('manager', 'data_manager', 'asset_manager', 'inventory_manager')
    )
    or public.is_platform_admin()
  )
  with check (
    (
      company_id = public.current_company_id()
      and public.has_any_role('manager', 'data_manager', 'asset_manager', 'inventory_manager')
    )
    or public.is_platform_admin()
  );

-- Import-låsen genverificerer rollen (SECURITY DEFINER omgår RLS).
create or replace function public.try_import_lock_self(p_company_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_company_id is null
     or not (p_company_id = public.current_company_id() or public.is_platform_admin())
     or not (
       public.has_any_role('manager', 'data_manager', 'asset_manager', 'inventory_manager')
       or public.is_platform_admin()
     ) then
    raise exception 'not allowed';
  end if;
  return public.try_import_lock(p_company_id);
end;
$$;

create or replace function public.release_import_lock_self(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_company_id is null
     or not (p_company_id = public.current_company_id() or public.is_platform_admin())
     or not (
       public.has_any_role('manager', 'data_manager', 'asset_manager', 'inventory_manager')
       or public.is_platform_admin()
     ) then
    raise exception 'not allowed';
  end if;
  perform public.release_import_lock(p_company_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Aktiver: asset_manager sidestilles med manager (registre + udlån via
-- can_write_assets, som lend_asset/return_asset gentjekker).
drop policy asset_categories_write on public.asset_categories;
create policy asset_categories_write on public.asset_categories
  for all to authenticated
  using (
    (company_id = public.current_company_id() and public.has_any_role('manager', 'asset_manager'))
    or public.is_platform_admin()
  )
  with check (
    (company_id = public.current_company_id() and public.has_any_role('manager', 'asset_manager'))
    or public.is_platform_admin()
  );

drop policy asset_locations_write on public.asset_locations;
create policy asset_locations_write on public.asset_locations
  for all to authenticated
  using (
    (company_id = public.current_company_id() and public.has_any_role('manager', 'asset_manager'))
    or public.is_platform_admin()
  )
  with check (
    (company_id = public.current_company_id() and public.has_any_role('manager', 'asset_manager'))
    or public.is_platform_admin()
  );

drop policy assets_write on public.assets;
create policy assets_write on public.assets
  for all to authenticated
  using (
    (company_id = public.current_company_id() and public.has_any_role('manager', 'asset_manager'))
    or public.is_platform_admin()
  )
  with check (
    (company_id = public.current_company_id() and public.has_any_role('manager', 'asset_manager'))
    or public.is_platform_admin()
  );

create or replace function public.can_write_assets(p_company_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (p_company_id = public.current_company_id() and public.has_any_role('manager', 'asset_manager'))
      or public.is_platform_admin()
$$;

-- ---------------------------------------------------------------------------
-- Lager: inventory_manager sidestilles med manager; håndterminalens
-- UPDATE-adgang flytter fra parcel_handler til handheld_inventory_handler
-- (stadig betinget af hh_stock-featurekøbet).
drop policy inventory_items_write on public.inventory_items;
create policy inventory_items_write on public.inventory_items
  for all to authenticated
  using (
    (company_id = public.current_company_id() and public.has_any_role('manager', 'inventory_manager'))
    or public.is_platform_admin()
  )
  with check (
    (company_id = public.current_company_id() and public.has_any_role('manager', 'inventory_manager'))
    or public.is_platform_admin()
  );

drop policy inventory_items_update_handler on public.inventory_items;
create policy inventory_items_update_handler on public.inventory_items
  for update to authenticated
  using (
    company_id = public.current_company_id()
    and public.has_role('handheld_inventory_handler')
    and public.has_feature('hh_stock')
  )
  with check (
    company_id = public.current_company_id()
    and public.has_role('handheld_inventory_handler')
    and public.has_feature('hh_stock')
  );

-- ---------------------------------------------------------------------------
-- Ruteplanlægning: route_planner_manager sidestilles med manager.
drop policy routes_write on public.routes;
create policy routes_write on public.routes
  for all to authenticated
  using (
    (company_id = public.current_company_id() and public.has_any_role('manager', 'route_planner_manager'))
    or public.is_platform_admin()
  )
  with check (
    (company_id = public.current_company_id() and public.has_any_role('manager', 'route_planner_manager'))
    or public.is_platform_admin()
  );
