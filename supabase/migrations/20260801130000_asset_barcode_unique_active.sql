-- Stregkoden skal være unik blandt AKTIVE aktiver — udfasede tæller ikke med.
--
-- Begrundelse: en fysisk stregkode-label genbruges i praksis, når et aktiv
-- kasseres og erstattes (samme hylde, samme label). Med den globale
-- unik-constraint (20260717160000) ville det kræve at man først fjernede
-- koden fra det udfasede aktiv — og så mistede historikken sin identifikator.
-- I stedet: partielt unikt indeks, der kun dækker status <> 'retired'. En
-- scanning skal stadig pege på præcis ét AKTIVT aktiv; flow-siderne viser i
-- forvejen en flertydighedsliste, hvis et udfaset aktiv deler koden.
--
-- Indeksnavnet indeholder bevidst 'barcode' — webbens 23505-håndtering skelner
-- aktiv-nr./stregkode på constraint-navnet i fejlbeskeden.

alter table public.assets drop constraint assets_company_id_barcode_key;

create unique index assets_company_barcode_active_uniq
  on public.assets (company_id, barcode)
  where status <> 'retired';

-- Genindsættelse er den eneste vej TILBAGE ind i indekset: er stregkoden
-- imens givet til et andet aktivt aktiv, skal kalderen have en ren fejlkode
-- (barcode_taken) i stedet for en rå unik-fejl — så manageren kan rette
-- stregkoden først. Ellers uændret fra 20260801090200.
create or replace function public.reinstate_asset(p_asset_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_asset public.assets;
begin
  select * into v_asset from public.assets where id = p_asset_id;
  if not found then
    raise exception 'asset_not_found' using errcode = 'P0002';
  end if;
  if not public.can_write_assets(v_asset.company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_asset.status <> 'retired' then
    raise exception 'not_retired' using errcode = 'P0001';
  end if;
  if v_asset.barcode is not null and exists (
    select 1 from public.assets a
    where a.company_id = v_asset.company_id
      and a.barcode = v_asset.barcode
      and a.id <> v_asset.id
      and a.status <> 'retired'
  ) then
    raise exception 'barcode_taken' using errcode = 'P0001';
  end if;

  perform set_config('operia.asset_flow_rpc', '1', true);
  update public.assets
     set status = 'in_stock', retired_at = null, retired_reason = null
   where id = v_asset.id;

  insert into public.asset_events
    (asset_id, company_id, event_type, from_status, to_status, actor_user_id)
  values
    (v_asset.id, v_asset.company_id, 'reinstated', 'retired', 'in_stock', auth.uid());
end;
$$;
