-- Hver påmindelse kan slås helt fra. Påmindelse 2 kan ikke stå alene
-- (deaktiveres automatisk med påmindelse 1). Platform-standard + virksomheds-
-- override (null = arv, sættes altid som samlet gruppe med de øvrige
-- pakkeflow-felter).
alter table public.platform_settings
  add column parcel_reminder_1_enabled boolean not null default true,
  add column parcel_reminder_2_enabled boolean not null default true;

alter table public.platform_settings
  add constraint platform_settings_reminder_enable_order
    check (parcel_reminder_1_enabled or not parcel_reminder_2_enabled);

alter table public.companies
  add column parcel_reminder_1_enabled boolean,
  add column parcel_reminder_2_enabled boolean;

alter table public.companies
  add constraint companies_reminder_enable_order
    check (
      parcel_reminder_1_enabled is null
      or parcel_reminder_2_enabled is null
      or parcel_reminder_1_enabled
      or not parcel_reminder_2_enabled
    );
