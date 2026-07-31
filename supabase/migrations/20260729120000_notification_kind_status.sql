-- Statusbesked ("Package Status"): et dagligt sammendrag der samler alle pakker
-- ankommet siden sidste statusbesked i ÉN besked pr. modtager, i stedet for én
-- besked pr. pakke.
--
-- Egen migration, fordi Postgres ikke tillader at en ny enum-værdi bruges i
-- samme transaktion som den tilføjes (samme mønster som 20260718111000 for
-- 'manual'). Selve kolonnerne, skabelonerne og indekserne følger i
-- 20260729130000_parcel_status_notifications.sql.
alter type public.notification_kind add value if not exists 'status';
