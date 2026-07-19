-- Rollemodel v2: udvider app_role med produkt-opdelte roller (spec 2026-07-19).
-- Eksisterende: manager (alt hos kunden), parcel_handler (web: modtag/udlevér),
-- final_receiver (ingen systemadgang). NB: 'parcel_handler' skifter betydning
-- fra "håndterminal-bruger" til "web-pakkehåndterer"; håndterminalen får sin
-- egen rolle (handheld_parcel_handler) — datakopiering sker i næste migration,
-- fordi nye enum-værdier ikke kan bruges i samme transaktion som de tilføjes.
--
-- "handler"-roller uden defineret sideadgang endnu (asset_handler,
-- handheld_asset_handler, inventory_handler, handheld_inventory_handler,
-- route_planner_handler) oprettes nu, så tildelingen kan konfigureres, men
-- de åbner kun forsiden indtil deres sider er defineret.

alter type public.app_role add value if not exists 'data_manager';
alter type public.app_role add value if not exists 'parcel_manager';
alter type public.app_role add value if not exists 'handheld_parcel_handler';
alter type public.app_role add value if not exists 'asset_handler';
alter type public.app_role add value if not exists 'asset_manager';
alter type public.app_role add value if not exists 'handheld_asset_handler';
alter type public.app_role add value if not exists 'inventory_handler';
alter type public.app_role add value if not exists 'inventory_manager';
alter type public.app_role add value if not exists 'handheld_inventory_handler';
alter type public.app_role add value if not exists 'route_planner_handler';
alter type public.app_role add value if not exists 'route_planner_manager';
alter type public.app_role add value if not exists 'handheld_route_planner';
