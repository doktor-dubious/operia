-- Statusbeskeden skal også rapportere UDLEVEREDE pakker, ikke kun dem der
-- venter. Dispatcheren henter nu både åbne pakker (ankommet siden sidste
-- sammendrag) og pakker med status 'delivered' (udleveret siden sidste
-- sammendrag), og bygger to afsnit.
--
-- Nye koder i skabelonen:
--   {{delivered_count}} — antal udleverede pakker i sammendraget
--   {{delivered_list}}  — afsnittet "Udleveret:" med én linje pr. pakke/batch,
--                         inkl. "(til <navn>)" når pakken er udleveret til en
--                         anden end modtageren selv (fuldmagt).
-- Som {{parcel_list}} indeholder listen sin EGEN overskrift og er tom når der
-- intet er at melde — skabeloner har ingen betingelser, så et tomt afsnit ville
-- ellers efterlade en overskrift uden indhold.
--
-- Platform-standarderne opdateres i stedet for at indsættes; virksomhedernes
-- egne overrides i company_templates røres ikke (de beholder deres tekst og får
-- dermed ikke afsnittet med udleveringer, før de selv tilføjer koden).

update public.platform_templates set
  title = 'Status på dine pakker',
  body = E'Hej {{recipient_name}},\n\nHer er status på dine pakker siden sidste statusbesked:\n\n{{parcel_list}}\n{{delivered_list}}\nMed venlig hilsen\n{{company_name}}'
where key = 'package_status' and lang = 'da';

update public.platform_templates set
  title = 'Status on your parcels',
  body = E'Hi {{recipient_name}},\n\nHere is the status of your parcels since the last status message:\n\n{{parcel_list}}\n{{delivered_list}}\nKind regards\n{{company_name}}'
where key = 'package_status' and lang = 'en';

update public.platform_templates set
  body = 'Hej {{recipient_name}}. Status: {{count}} pakke(r) venter i varemodtagelsen, {{delivered_count}} udleveret. Mvh {{company_name}}'
where key = 'package_status_sms' and lang = 'da';

update public.platform_templates set
  body = 'Hi {{recipient_name}}. Status: {{count}} parcel(s) waiting at goods reception, {{delivered_count}} handed over. Regards {{company_name}}'
where key = 'package_status_sms' and lang = 'en';
