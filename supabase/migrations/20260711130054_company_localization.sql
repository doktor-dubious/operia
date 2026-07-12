-- Lokalisering pr. virksomhed (fra prototypens company_config-scope):
-- standardsprog, tidszone, understøttede sprog og stilletid (bruges af
-- notifikationer — Flow 1: ingen SMS/e-mail i stilletiden).
alter table public.companies
  add column default_language text not null default 'da',
  add column timezone text not null default 'Europe/Copenhagen',
  add column supported_languages text[] not null default '{da,en}',
  add column quiet_hours_start time,
  add column quiet_hours_end time;
