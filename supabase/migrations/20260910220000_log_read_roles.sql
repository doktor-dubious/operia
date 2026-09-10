-- Læseadgangen til loggene strammes fra "enhver bruger i virksomheden" til
-- ansvarsrollerne (EVU-krav D-03 og F-01).
--
-- Indtil nu stod der kun tenant-grænsen i læsepolitikkerne: `company_id =
-- current_company_id()`. Siderne var rollestyrede i UI'et, men RÆKKERNE var det
-- ikke — en pakkehåndterer kunne hente hele virksomhedens ændringslog gennem
-- API'et. Ingen data slap ud mellem kunder, men "knappen er skjult" er et
-- svagere udsagn end "rollen kan ikke læse det", og det er dét, en
-- rettighedsmatrix til kunden skal kunne påstå.
--
-- TO FORSKELLIGE ROLLESÆT, fordi de to logge har to forskellige læserkredse:
--
--   booking_events — kun manager og booking_manager. Det er præcis dem,
--   historiksiden er åben for, så politik og sideadgang siger nu det samme.
--
--   audit_log — alle *ansvarsroller*, ikke kun manager. Loggen er
--   tværgående, og flere sider læser den under deres EGEN rolle: aktiv- og
--   lagerimportens logsider (module-import-log.tsx) henter
--   'import_config'-rækker som asset_manager henholdsvis inventory_manager, og
--   ai_label_usage er SECURITY INVOKER og læser den som kalderen. Strammer man
--   til manager alene, går netop de sider i stykker for netop de brugere, de er
--   bygget til. Den meningsfulde afgrænsning er derfor at lukke HÅNDTERERNE
--   ude — den største brugergruppe — og lade de ansvarlige blive.
--
-- Platform-admins beholder deres adgang i begge, som før.
--
-- Bemærk at dette er LÆSNING. Skrivning var allerede umulig for alle
-- klientroller (20260910180000): ingen skrivepolitik, ingen rettigheder.

drop policy if exists booking_events_select on public.booking_events;
create policy booking_events_select on public.booking_events
  for select to authenticated
  using (
    (company_id = public.current_company_id()
     and public.has_any_role('manager', 'booking_manager'))
    or public.is_platform_admin()
  );

drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (
    (company_id = public.current_company_id()
     and public.has_any_role(
       'manager', 'data_manager', 'parcel_manager', 'asset_manager',
       'inventory_manager', 'route_planner_manager', 'booking_manager'))
    or public.is_platform_admin()
  );
