-- Korte SMS-varianter af pakke-notifikationsskabelonerne. E-mail-skabelonerne
-- (package_arrival / _reminder_1 / _reminder_2) er lange og har emne; en SMS
-- skal være kort og har ingen emne (title = ''). Samme sprogneutrale
-- {{snake_case}}-tokens som e-mailen, erstattet ved afsendelse.
--
-- company_editable = true → de dukker automatisk op i Konfigurér → Skabeloner,
-- hvor en virksomhed kan gemme sin egen udgave pr. (key, lang).

insert into public.platform_templates (key, lang, name, kind, title, body, company_editable) values
  (
    'package_arrival_sms', 'da', 'Package Arrival (SMS)', 'text', '',
    'Hej {{recipient_name}}. Din pakke {{barcode}} er ankommet og kan afhentes i varemodtagelsen. Mvh {{company_name}}',
    true
  ),
  (
    'package_arrival_sms', 'en', 'Package Arrival (SMS)', 'text', '',
    'Hi {{recipient_name}}. Your parcel {{barcode}} has arrived and can be collected at goods reception. Regards {{company_name}}',
    true
  ),
  (
    'package_reminder_1_sms', 'da', 'Package Reminder 1 (SMS)', 'text', '',
    'Hej {{recipient_name}}. Påmindelse: din pakke {{barcode}} venter stadig i varemodtagelsen. Mvh {{company_name}}',
    true
  ),
  (
    'package_reminder_1_sms', 'en', 'Package Reminder 1 (SMS)', 'text', '',
    'Hi {{recipient_name}}. Reminder: your parcel {{barcode}} is still waiting at goods reception. Regards {{company_name}}',
    true
  ),
  (
    'package_reminder_2_sms', 'da', 'Package Reminder 2 (SMS)', 'text', '',
    'Hej {{recipient_name}}. Sidste påmindelse: din pakke {{barcode}} venter i varemodtagelsen — afhent den snarest. Mvh {{company_name}}',
    true
  ),
  (
    'package_reminder_2_sms', 'en', 'Package Reminder 2 (SMS)', 'text', '',
    'Hi {{recipient_name}}. Final reminder: your parcel {{barcode}} is waiting at goods reception — please collect it soon. Regards {{company_name}}',
    true
  )
on conflict (key, lang) do nothing;
