-- 1) Katalogtekster på engelsk: name/description er dansk (standardsproget);
--    name_en/description_en bruges når brugerfladen står på engelsk.
-- 2) Manglende funktioner fra prototypens scope: Aktiver-funktionerne og
--    håndterminal-funktionerne under Pakker. Ruteplan/Forsendelse er BEVIDST
--    uden funktions-dubletter — de er selvstændige produkter hos os
--    (prototypens feature-udgaver var bagudkompatibilitet). Booking/IoT/
--    Smarte skabe har heller ingen funktioner i prototypen.

alter table public.product_catalog
  add column name_en text,
  add column description_en text;

alter table public.feature_catalog
  add column name_en text,
  add column description_en text;

update public.product_catalog set name_en = v.name_en, description_en = v.description_en
from (values
  ('parcels',  'Parcels',        'Track & trace for internal parcels (core product)'),
  ('assets',   'Assets',         'Asset and inventory management'),
  ('lockers',  'Smart lockers',  'Handover via smart lockers'),
  ('iot',      'IoT sensors',    'Sensor data and alerts'),
  ('shipping', 'Shipping',       'Outbound shipments via carriers'),
  ('routes',   'Route planning', 'Internal distribution routes'),
  ('booking',  'Room booking',   'Meeting rooms and invoicing')
) as v(key, name_en, description_en)
where product_catalog.key = v.key;

update public.feature_catalog set name_en = v.name_en, description_en = v.description_en
from (values
  ('reminders',    'Reminders',     'Automatic reminders about uncollected parcels'),
  ('signature',    'Signature',     'On-screen signature at handover'),
  ('photo',        'Condition photo', 'Photo of the parcel''s condition at intake'),
  ('label_print',  'Label print',   'Printing of internal labels'),
  ('nfc_handover', 'NFC handover',  'Identity via NFC/MIFARE card at handover')
) as v(key, name_en, description_en)
where feature_catalog.key = v.key;

insert into public.feature_catalog (key, product_key, name, description, name_en, description_en) values
  -- Pakker (fra prototypens intra-funktioner)
  ('receive_to_department', 'parcels', 'Modtag til afdeling', 'Modtag pakker direkte til en afdeling',
   'Receive to department', 'Receive parcels directly to a department'),
  ('export', 'parcels', 'Eksport', 'Eksportér pakker til CSV/JSON',
   'Export', 'Export parcels to CSV/JSON'),
  ('audit_log', 'parcels', 'Ændringslog', 'Fuld revisionsspor over ændringer',
   'Change log', 'Full audit trail of changes'),
  ('locker_delivery', 'parcels', 'Smart locker-aflevering', 'Aflevering i smart locker med adgangskode (Keynius)',
   'Smart locker delivery', 'Delivery into a smart locker with access code (Keynius)'),
  ('hh_receive', 'parcels', 'Håndterminal: Modtag', 'Modtag pakker på håndterminalen (scan & registrér)',
   'Handheld: Receive', 'Receive parcels on the handheld (scan & register)'),
  ('hh_handout', 'parcels', 'Håndterminal: Udlever', 'Udlever pakker på håndterminalen (find, kvittér, underskrift)',
   'Handheld: Hand out', 'Hand out parcels on the handheld (find, receipt, signature)'),
  ('hh_search', 'parcels', 'Håndterminal: Søg', 'Søg efter pakker på håndterminalen',
   'Handheld: Search', 'Search for parcels on the handheld'),
  ('hh_multidept', 'parcels', 'Håndterminal: Flere afdelinger', 'Scan pakker til forskellige afdelinger i én modtagelse',
   'Handheld: Multiple departments', 'Scan parcels for different departments in one intake'),
  ('hh_to_department', 'parcels', 'Modtag til: Afdeling', 'Vælg afdeling som modtager på håndterminalen',
   'Receive to: Department', 'Choose a department as receiver on the handheld'),
  ('hh_to_employee', 'parcels', 'Modtag til: Medarbejder', 'Vælg medarbejder/modtager som modtager',
   'Receive to: Employee', 'Choose an employee as receiver'),
  ('hh_to_company', 'parcels', 'Modtag til: Virksomhed', 'Vælg virksomhed som modtager (kontormiljø / flere virksomheder)',
   'Receive to: Company', 'Choose a company as receiver (office hotel / multiple companies)'),
  ('hh_email_on_receive', 'parcels', 'Håndterminal: Mail ved modtagelse', 'Send en ankomst-mail til modtageren når en pakke modtages på håndterminalen',
   'Handheld: Email on receive', 'Send an arrival email to the receiver when a parcel is received on the handheld'),
  ('hh_route', 'parcels', 'Håndterminal: Ruteplan', 'Vis gemte ruter på håndterminalen og naviger via Google Maps',
   'Handheld: Route plan', 'Show saved routes on the handheld and navigate via Google Maps'),
  ('hh_stock', 'parcels', 'Håndterminal: Lager', 'Lager på håndterminalen: opslag, vareind, vareud og optælling',
   'Handheld: Inventory', 'Inventory on the handheld: lookup, goods in, goods out and counting'),
  -- Aktiver (fra prototypens assets-funktioner)
  ('warehouse', 'assets', 'Lagerstyring', 'Lager-fane og antalsbaserede varer i Aktiver',
   'Inventory', 'Inventory tab and quantity-based items in Assets'),
  ('scan', 'assets', 'Scanning', 'Stregkode/QR-scanning, pluk-tilstand og kamera i Aktiver',
   'Scanning', 'Barcode/QR scanning, picking mode and camera in Assets'),
  ('asset_labels', 'assets', 'Labels / print', 'Print QR-/stregkode-labels fra et aktiv (Brother TD-4550DNWB)',
   'Labels / print', 'Print QR/barcode labels from an asset (Brother TD-4550DNWB)'),
  ('locker_loans', 'assets', 'Smart locker-udlån', 'Selvbetjent afhentning/retur via smart locker (Keynius)',
   'Smart locker loans', 'Self-service pickup/return via smart locker (Keynius)'),
  ('iot_tracking', 'assets', 'IoT-sporing (LoRaWAN)', 'Placerings-/tilstandssensorer på dyre aktiver (Milesight)',
   'IoT tracking (LoRaWAN)', 'Location/condition sensors on expensive assets (Milesight)')
on conflict (key) do nothing;
