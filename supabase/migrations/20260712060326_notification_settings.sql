-- Notifikationsindstillinger (Operia → Notifikationer / Konfigurér →
-- Notifikationer): pakkeflowets påmindelsesdage. Platformen har standarderne
-- (platform_settings); virksomheder kan override dem (null = arv platformens).
-- Platformen får også standard-stilletid til nye/nulstillede virksomheder.

alter table public.platform_settings
  add column quiet_hours_start time,
  add column quiet_hours_end time,
  add column parcel_reminder_1_days integer not null default 3
    check (parcel_reminder_1_days >= 1),
  add column parcel_reminder_2_days integer not null default 7;

alter table public.platform_settings
  add constraint platform_settings_reminder_order
    check (parcel_reminder_2_days > parcel_reminder_1_days);

-- Virksomhedens override: begge sættes sammen (én "pakkeflow"-indstilling);
-- null betyder at platformens standard gælder.
alter table public.companies
  add column parcel_reminder_1_days integer
    check (parcel_reminder_1_days is null or parcel_reminder_1_days >= 1),
  add column parcel_reminder_2_days integer;

alter table public.companies
  add constraint companies_reminder_order
    check (
      parcel_reminder_2_days is null
      or parcel_reminder_1_days is null
      or parcel_reminder_2_days > parcel_reminder_1_days
    );
