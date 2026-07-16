-- Håndterminal-lager: UPDATE-policyen for parcel_handlers manglede
-- entitlement-checket — hh_stock var kun gated i appen, men klienten er
-- utroværdig (CLAUDE.md). Uden feature-købet skal en handler ikke kunne
-- skrive lagerdata via PostgREST direkte.
drop policy inventory_items_update_handler on public.inventory_items;

create policy inventory_items_update_handler on public.inventory_items
  for update to authenticated
  using (
    company_id = public.current_company_id()
    and public.has_role('parcel_handler')
    and public.has_feature('hh_stock')
  )
  with check (
    company_id = public.current_company_id()
    and public.has_role('parcel_handler')
    and public.has_feature('hh_stock')
  );
