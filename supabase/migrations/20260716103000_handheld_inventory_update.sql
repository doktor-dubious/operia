-- Håndterminal-lager (feature hh_stock): pakke-/lagerpersonale registrerer
-- vareind, vareud og optælling fra terminalen. Skrivning på inventory_items
-- var manager-only — parcel_handler får UPDATE (ikke insert/delete; varer
-- oprettes og slettes stadig kun i admin af managers).
create policy inventory_items_update_handler on public.inventory_items
  for update to authenticated
  using (company_id = public.current_company_id() and public.has_role('parcel_handler'))
  with check (company_id = public.current_company_id() and public.has_role('parcel_handler'));
