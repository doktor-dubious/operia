-- Maks. antal påmindelser pr. pakke (0 = ingen grænse; der stoppes altid når
-- pakken er afhentet). Platformens standard + virksomheds-override (null = arv).
alter table public.platform_settings
  add column parcel_reminder_max integer not null default 0
    check (parcel_reminder_max >= 0);

alter table public.companies
  add column parcel_reminder_max integer
    check (parcel_reminder_max is null or parcel_reminder_max >= 0);
