-- Skabeloner for aktiv-udlåns-notifikationer (udløb + to påmindelser), e-mail og
-- SMS, dansk + engelsk. Sprogneutrale {{snake_case}}-tokens: {{recipient_name}}
-- (låner), {{asset_name}} (aktivets navn/tag), {{expiry_date}}, {{company_name}}.
-- company_editable = true → redigerbare i Konfigurér → Skabeloner.

insert into public.platform_templates (key, lang, name, kind, title, body, company_editable) values
  -- Udløbs-besked (sendes på udløbsdagen)
  (
    'asset_expiry', 'da', 'Asset Expiry', 'text',
    'Dit lånte udstyr skal returneres',
    E'Hej {{recipient_name}},\n\nDit lån af {{asset_name}} er udløbet d. {{expiry_date}}. Returnér det venligst hurtigst muligt.\n\nMed venlig hilsen\n{{company_name}}',
    true
  ),
  (
    'asset_expiry', 'en', 'Asset Expiry', 'text',
    'Your borrowed equipment is due for return',
    E'Hi {{recipient_name}},\n\nYour loan of {{asset_name}} expired on {{expiry_date}}. Please return it as soon as possible.\n\nKind regards\n{{company_name}}',
    true
  ),
  (
    'asset_expiry_sms', 'da', 'Asset Expiry (SMS)', 'text', '',
    'Hej {{recipient_name}}. Dit lån af {{asset_name}} udløb {{expiry_date}} — returnér det venligst snarest. Mvh {{company_name}}',
    true
  ),
  (
    'asset_expiry_sms', 'en', 'Asset Expiry (SMS)', 'text', '',
    'Hi {{recipient_name}}. Your loan of {{asset_name}} expired {{expiry_date}} — please return it soon. Regards {{company_name}}',
    true
  ),

  -- Påmindelse 1
  (
    'asset_reminder_1', 'da', 'Asset Reminder 1', 'text',
    'Påmindelse: returnér dit lånte udstyr',
    E'Hej {{recipient_name}},\n\nPåmindelse: dit lån af {{asset_name}}, udløbet d. {{expiry_date}}, er endnu ikke returneret.\n\nMed venlig hilsen\n{{company_name}}',
    true
  ),
  (
    'asset_reminder_1', 'en', 'Asset Reminder 1', 'text',
    'Reminder: return your borrowed equipment',
    E'Hi {{recipient_name}},\n\nReminder: your loan of {{asset_name}}, expired on {{expiry_date}}, has not been returned yet.\n\nKind regards\n{{company_name}}',
    true
  ),
  (
    'asset_reminder_1_sms', 'da', 'Asset Reminder 1 (SMS)', 'text', '',
    'Hej {{recipient_name}}. Påmindelse: dit lån af {{asset_name}} (udløbet {{expiry_date}}) mangler stadig at blive returneret. Mvh {{company_name}}',
    true
  ),
  (
    'asset_reminder_1_sms', 'en', 'Asset Reminder 1 (SMS)', 'text', '',
    'Hi {{recipient_name}}. Reminder: your loan of {{asset_name}} (expired {{expiry_date}}) has not been returned. Regards {{company_name}}',
    true
  ),

  -- Påmindelse 2
  (
    'asset_reminder_2', 'da', 'Asset Reminder 2', 'text',
    'Sidste påmindelse: returnér dit lånte udstyr',
    E'Hej {{recipient_name}},\n\nSidste påmindelse: dit lån af {{asset_name}}, udløbet d. {{expiry_date}}, er stadig ikke returneret. Kontakt os, hvis du ikke selv kan returnere det.\n\nMed venlig hilsen\n{{company_name}}',
    true
  ),
  (
    'asset_reminder_2', 'en', 'Asset Reminder 2', 'text',
    'Final reminder: return your borrowed equipment',
    E'Hi {{recipient_name}},\n\nFinal reminder: your loan of {{asset_name}}, expired on {{expiry_date}}, is still not returned. Contact us if you cannot return it yourself.\n\nKind regards\n{{company_name}}',
    true
  ),
  (
    'asset_reminder_2_sms', 'da', 'Asset Reminder 2 (SMS)', 'text', '',
    'Hej {{recipient_name}}. Sidste påmindelse: returnér {{asset_name}} (udløbet {{expiry_date}}) snarest. Mvh {{company_name}}',
    true
  ),
  (
    'asset_reminder_2_sms', 'en', 'Asset Reminder 2 (SMS)', 'text', '',
    'Hi {{recipient_name}}. Final reminder: please return {{asset_name}} (expired {{expiry_date}}) soon. Regards {{company_name}}',
    true
  )
on conflict (key, lang) do nothing;
