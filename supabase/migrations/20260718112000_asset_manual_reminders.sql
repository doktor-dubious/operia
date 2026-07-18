-- Manuelle aktiv-påmindelser ("Send påmindelse nu"): skabeloner + dedup-justering.
--
-- 1) Dedup-indekset asset_loan_notifications_once_idx sikrer, at cron højst
--    sender ÉN gennemført besked pr. (udlån, type, kanal). Manuelle påmindelser
--    skal derimod kunne sendes gentagne gange (en manager kan nudge flere gange),
--    så de UNDTAGES fra indekset — hver manuel afsendelse logges som sin egen
--    række. ('manual' er tilføjet i 20260718111000 og er committet nu.)
drop index if exists public.asset_loan_notifications_once_idx;
create unique index asset_loan_notifications_once_idx
  on public.asset_loan_notifications (loan_id, kind, channel)
  where status = 'sent' and kind <> 'manual';

-- 2) Skabeloner til den manuelle påmindelse. Bevidst UDLØBS-NEUTRAL ordlyd:
--    knappen kan trykkes før som efter udløb (render() kan ikke betinge på
--    {{expiry_date}}), så teksten nævner ikke en udløbsdato. Samme
--    {{snake_case}}-tokens som de øvrige aktiv-skabeloner. company_editable →
--    redigerbare i Konfigurér → Skabeloner.
insert into public.platform_templates (key, lang, name, kind, title, body, company_editable) values
  (
    'asset_manual', 'da', 'Asset Manual Reminder', 'text',
    'Påmindelse om lånt udstyr',
    E'Hej {{recipient_name}},\n\nDette er en påmindelse om, at du har {{asset_name}} til låns fra {{company_name}}. Returnér det venligst snarest.\n\nMed venlig hilsen\n{{company_name}}',
    true
  ),
  (
    'asset_manual', 'en', 'Asset Manual Reminder', 'text',
    'Reminder about borrowed equipment',
    E'Hi {{recipient_name}},\n\nThis is a reminder that you have {{asset_name}} on loan from {{company_name}}. Please return it as soon as possible.\n\nKind regards\n{{company_name}}',
    true
  ),
  (
    'asset_manual_sms', 'da', 'Asset Manual Reminder (SMS)', 'text', '',
    'Hej {{recipient_name}}. Påmindelse: du har {{asset_name}} til låns fra {{company_name}}. Returnér det venligst snarest.',
    true
  ),
  (
    'asset_manual_sms', 'en', 'Asset Manual Reminder (SMS)', 'text', '',
    'Hi {{recipient_name}}. Reminder: you have {{asset_name}} on loan from {{company_name}}. Please return it soon.',
    true
  )
on conflict (key, lang) do nothing;
