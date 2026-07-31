-- batch_code er server-tildelt: parcel_batches_guard genererer den ved INSERT
-- (og validerer/normaliserer en medsendt værdi). Klienten kan derfor ikke — og
-- skal ikke — sende den. Med 'not null' krævede de genererede DB-typer alligevel
-- feltet ved insert, hvilket ikke kan opfyldes fra browseren.
--
-- Samme model som parcels.barcode (nullable + parcels_guard genererer OPR-koden,
-- jf. 20260728100500): kolonnen er nullable i skemaet, mens guard'en garanterer
-- at der altid står en unik kode i den. Unikhed pr. virksomhed håndhæves
-- fortsat af unique (company_id, batch_code).
alter table public.parcel_batches
  alter column batch_code drop not null;
