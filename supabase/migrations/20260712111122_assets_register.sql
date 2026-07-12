-- Aktivregisteret (Aktiver-modulet): aktiver + deres kategorier og
-- placeringer pr. virksomhed. Registeret ejes af importen (som medarbejdere
-- ejes af Flow 0): appen opretter/redigerer ikke aktiver manuelt — kun
-- deaktivering (rækken består, historik bevares) og platform-admin-sletning
-- (testdata-oprydning). Ingen anonymisering: aktiver bærer ingen persondata.

create table public.asset_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  track text not null default 'serial' check (track in ('serial', 'qty')),
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

create table public.asset_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  kind text not null default 'site' check (kind in ('site', 'room', 'bin', 'vehicle', 'repair')),
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  asset_tag text,                -- aktiv-nr./tag (fx DCA-0001)
  name text not null,
  category_id uuid references public.asset_categories (id) on delete set null,
  serial_no text,
  location_id uuid references public.asset_locations (id) on delete set null,
  status text,
  condition text,
  purchased_at date,
  purchase_price numeric,
  warranty_until date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, asset_tag)
);

alter table public.asset_categories enable row level security;
alter table public.asset_locations enable row level security;
alter table public.assets enable row level security;

-- Samme mønster som medarbejdere: egen virksomhed læser; managers +
-- platform-admins skriver (UI'et begrænser hård sletning til platform-admins).
create policy asset_categories_select on public.asset_categories
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());
create policy asset_categories_write on public.asset_categories
  for all to authenticated
  using ((company_id = public.current_company_id() and public.has_role('manager')) or public.is_platform_admin())
  with check ((company_id = public.current_company_id() and public.has_role('manager')) or public.is_platform_admin());

create policy asset_locations_select on public.asset_locations
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());
create policy asset_locations_write on public.asset_locations
  for all to authenticated
  using ((company_id = public.current_company_id() and public.has_role('manager')) or public.is_platform_admin())
  with check ((company_id = public.current_company_id() and public.has_role('manager')) or public.is_platform_admin());

create policy assets_select on public.assets
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());
create policy assets_write on public.assets
  for all to authenticated
  using ((company_id = public.current_company_id() and public.has_role('manager')) or public.is_platform_admin())
  with check ((company_id = public.current_company_id() and public.has_role('manager')) or public.is_platform_admin());

grant select, insert, update, delete
  on public.asset_categories, public.asset_locations, public.assets to authenticated;

-- Revisionslog som de øvrige registre.
create or replace function public.audit_assets()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit(new.company_id, 'asset.created', 'asset', new.id::text,
      coalesce(new.name, new.asset_tag));
    return new;
  elsif tg_op = 'UPDATE' then
    if old.is_active and not new.is_active then
      perform public.record_audit(new.company_id, 'asset.deactivated', 'asset', new.id::text,
        coalesce(new.name, new.asset_tag));
    end if;
    return new;
  else
    perform public.record_audit(old.company_id, 'asset.deleted', 'asset', old.id::text,
      coalesce(old.name, old.asset_tag));
    return old;
  end if;
end;
$$;

create trigger audit_assets_trg
  after insert or update or delete on public.assets
  for each row execute function public.audit_assets();
