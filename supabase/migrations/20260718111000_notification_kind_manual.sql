-- Ny notifikationstype 'manual': en manuelt udløst påmindelse ("Send påmindelse
-- nu" på Låner-fanen), til forskel fra de cron-planlagte 'arrival'/'reminder_1'/
-- 'reminder_2'. Skal stå i sin EGEN migration: Postgres tillader ikke at en ny
-- enum-værdi tilføjes og bruges i samme transaktion (indeks-prædikat/insert i
-- 20260718112000 refererer 'manual', så den værdi skal være committet først).
alter type public.notification_kind add value if not exists 'manual';
