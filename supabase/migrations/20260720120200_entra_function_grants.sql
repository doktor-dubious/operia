-- Postgres giver som standard EXECUTE til PUBLIC på nye funktioner. Uden
-- denne oprydning kunne enhver indlogget bruger kalde fratrædelses- og
-- oprydningsfunktionerne direkte — de er SECURITY DEFINER og har (bevidst)
-- ingen egen autorisationskontrol, fordi kun synkroniseringen med service-role
-- må kalde dem. Samme mønster som record_audit.
revoke execute on function public.retire_employee(uuid, boolean, text) from public, anon, authenticated;
revoke execute on function public.unretire_employee(uuid) from public, anon, authenticated;
revoke execute on function public.sweep_retired_employees(uuid, text) from public, anon, authenticated;
revoke execute on function public.employee_has_open_parcels(uuid) from public, anon, authenticated;

-- anonymize_employee beholder sin grant: den kaldes af managere fra /employees
-- og kontrollerer selv kalderens virksomhed og rolle.
revoke execute on function public.anonymize_employee(uuid, text) from public, anon;
