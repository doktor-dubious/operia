-- Pakke-notifikationsskabeloner (ankomst + to påmindelser) fra prototypens
-- scope. Tokens er sprogneutrale {{snake_case}}-koder (Mustache-stil, som
-- {{link}} i invitationen); de erstattes ved afsendelse. Påmindelses-
-- intervallet ("send efter X dage") er bevidst IKKE en del af skabelonen —
-- det hører til i pakkeflow-/notifikationskonfigurationen pr. virksomhed.

-- Kun skabeloner markeret company_editable vises på Konfigurér → Skabeloner
-- (kundens overrides); invitationen er DCA-intern.
alter table public.platform_templates
  add column company_editable boolean not null default true;

update public.platform_templates set company_editable = false where key = 'customer_invite';

insert into public.platform_templates (key, lang, name, kind, title, body) values
  (
    'package_arrival', 'da', 'Package Arrival', 'text',
    'Din pakke er ankommet',
    E'Hej {{recipient_name}},\n\nVi har i dag d. {{date}} modtaget en pakke til dig med stregkode {{barcode}}.\nPakken kan afhentes i varemodtagelsen.\n\nMed venlig hilsen\n{{company_name}}'
  ),
  (
    'package_arrival', 'en', 'Package Arrival', 'text',
    'Your parcel has arrived',
    E'Hi {{recipient_name}},\n\nToday, {{date}}, we received a parcel for you with barcode {{barcode}}.\nThe parcel can be collected at goods reception.\n\nKind regards\n{{company_name}}'
  ),
  (
    'package_reminder_1', 'da', 'Package Reminder 1', 'text',
    'Påmindelse: din pakke venter',
    E'Hej {{recipient_name}},\n\nDin pakke med stregkode {{barcode}}, modtaget d. {{date}}, venter stadig i varemodtagelsen.\n\nMed venlig hilsen\n{{company_name}}'
  ),
  (
    'package_reminder_1', 'en', 'Package Reminder 1', 'text',
    'Reminder: your parcel is waiting',
    E'Hi {{recipient_name}},\n\nYour parcel with barcode {{barcode}}, received on {{date}}, is still waiting at goods reception.\n\nKind regards\n{{company_name}}'
  ),
  (
    'package_reminder_2', 'da', 'Package Reminder 2', 'text',
    'Sidste påmindelse: din pakke venter',
    E'Hej {{recipient_name}},\n\nDette er sidste påmindelse: din pakke med stregkode {{barcode}}, modtaget d. {{date}}, venter stadig i varemodtagelsen. Kontakt varemodtagelsen, hvis du ikke selv kan afhente den.\n\nMed venlig hilsen\n{{company_name}}'
  ),
  (
    'package_reminder_2', 'en', 'Package Reminder 2', 'text',
    'Final reminder: your parcel is waiting',
    E'Hi {{recipient_name}},\n\nThis is the final reminder: your parcel with barcode {{barcode}}, received on {{date}}, is still waiting at goods reception. Contact goods reception if you cannot collect it yourself.\n\nKind regards\n{{company_name}}'
  )
on conflict (key, lang) do nothing;
