-- Batch-notifikationer: én besked for hele batchen i stedet for én pr. pakke.
-- Dispatcheren grupperer 'finished' batches og sender én ankomst/påmindelse med
-- et {{count}}-token. Dedup flyttes fra pakke- til batch-niveau for batch-rækker.

-- Loggen får en (valgfri) batch-reference. Ingen FK — som resten af logsporet
-- holdes den afkoblet, så en slettet batch ikke rører revisionssporet.
alter table public.parcel_notifications
  add column batch_id uuid;

create index parcel_notifications_batch_idx on public.parcel_notifications (batch_id)
  where batch_id is not null;

-- Dedup på batch-niveau: højst én GENNEMFØRT afsendelse pr. batch/type/kanal.
-- (Det eksisterende pakke-indeks parcel_notifications_once_idx gælder stadig for
-- pakker uden batch.)
create unique index parcel_notifications_batch_once_idx
  on public.parcel_notifications (batch_id, kind, channel)
  where batch_id is not null and status = 'sent';

-- ── Batch-skabeloner: samme tokens som de enkelte pakkeskabeloner plus {{count}}
-- (antal pakker i batchen) og {{batch_code}} (batch-labelens kode). Bevidst uden
-- {{barcode}} — en batch har ikke én stregkode. ─────────────────────────────
insert into public.platform_templates (key, lang, name, kind, title, body, company_editable) values
  (
    'package_arrival_batch', 'da', 'Package Arrival (batch)', 'text',
    'Dine pakker er ankommet',
    E'Hej {{recipient_name}},\n\nVi har i dag d. {{date}} modtaget {{count}} pakker til dig (batch {{batch_code}}).\nPakkerne kan afhentes samlet i varemodtagelsen.\n\nMed venlig hilsen\n{{company_name}}',
    true
  ),
  (
    'package_arrival_batch', 'en', 'Package Arrival (batch)', 'text',
    'Your parcels have arrived',
    E'Hi {{recipient_name}},\n\nToday, {{date}}, we received {{count}} parcels for you (batch {{batch_code}}).\nThey can be collected together at goods reception.\n\nKind regards\n{{company_name}}',
    true
  ),
  (
    'package_reminder_1_batch', 'da', 'Package Reminder 1 (batch)', 'text',
    'Påmindelse: dine pakker venter',
    E'Hej {{recipient_name}},\n\nDine {{count}} pakker (batch {{batch_code}}), modtaget d. {{date}}, venter stadig i varemodtagelsen.\n\nMed venlig hilsen\n{{company_name}}',
    true
  ),
  (
    'package_reminder_1_batch', 'en', 'Package Reminder 1 (batch)', 'text',
    'Reminder: your parcels are waiting',
    E'Hi {{recipient_name}},\n\nYour {{count}} parcels (batch {{batch_code}}), received on {{date}}, are still waiting at goods reception.\n\nKind regards\n{{company_name}}',
    true
  ),
  (
    'package_reminder_2_batch', 'da', 'Package Reminder 2 (batch)', 'text',
    'Sidste påmindelse: dine pakker venter',
    E'Hej {{recipient_name}},\n\nDette er sidste påmindelse: dine {{count}} pakker (batch {{batch_code}}), modtaget d. {{date}}, venter stadig i varemodtagelsen. Kontakt varemodtagelsen, hvis du ikke selv kan afhente dem.\n\nMed venlig hilsen\n{{company_name}}',
    true
  ),
  (
    'package_reminder_2_batch', 'en', 'Package Reminder 2 (batch)', 'text',
    'Final reminder: your parcels are waiting',
    E'Hi {{recipient_name}},\n\nThis is the final reminder: your {{count}} parcels (batch {{batch_code}}), received on {{date}}, are still waiting at goods reception. Contact goods reception if you cannot collect them yourself.\n\nKind regards\n{{company_name}}',
    true
  ),
  (
    'package_arrival_batch_sms', 'da', 'Package Arrival batch (SMS)', 'text', '',
    'Hej {{recipient_name}}. {{count}} pakker (batch {{batch_code}}) er ankommet og kan afhentes samlet i varemodtagelsen. Mvh {{company_name}}',
    true
  ),
  (
    'package_arrival_batch_sms', 'en', 'Package Arrival batch (SMS)', 'text', '',
    'Hi {{recipient_name}}. {{count}} parcels (batch {{batch_code}}) have arrived and can be collected together at goods reception. Regards {{company_name}}',
    true
  ),
  (
    'package_reminder_1_batch_sms', 'da', 'Package Reminder 1 batch (SMS)', 'text', '',
    'Hej {{recipient_name}}. Påmindelse: dine {{count}} pakker (batch {{batch_code}}) venter stadig i varemodtagelsen. Mvh {{company_name}}',
    true
  ),
  (
    'package_reminder_1_batch_sms', 'en', 'Package Reminder 1 batch (SMS)', 'text', '',
    'Hi {{recipient_name}}. Reminder: your {{count}} parcels (batch {{batch_code}}) are still waiting at goods reception. Regards {{company_name}}',
    true
  ),
  (
    'package_reminder_2_batch_sms', 'da', 'Package Reminder 2 batch (SMS)', 'text', '',
    'Hej {{recipient_name}}. Sidste påmindelse: dine {{count}} pakker (batch {{batch_code}}) venter i varemodtagelsen — afhent dem snarest. Mvh {{company_name}}',
    true
  ),
  (
    'package_reminder_2_batch_sms', 'en', 'Package Reminder 2 batch (SMS)', 'text', '',
    'Hi {{recipient_name}}. Final reminder: your {{count}} parcels (batch {{batch_code}}) are waiting at goods reception — please collect them soon. Regards {{company_name}}',
    true
  )
on conflict (key, lang) do nothing;
