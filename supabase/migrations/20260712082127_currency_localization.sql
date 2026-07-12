-- Valuta-lokalisering, samme model som sprog: platformen udbyder et sæt
-- valutaer (Operia → Lokalisering) med en systemstandard; virksomhederne
-- vælger blandt platformens udvalg. Startudvalg: DKK, EUR, USD, SEK, NOK;
-- standard er danske kroner.
alter table public.platform_settings
  add column supported_currencies text[] not null default '{DKK,EUR,USD,SEK,NOK}',
  add column default_currency text not null default 'DKK';

alter table public.platform_settings
  add constraint platform_settings_currency_default
    check (default_currency = any (supported_currencies));

alter table public.companies
  add column supported_currencies text[] not null default '{DKK}',
  add column default_currency text not null default 'DKK';

alter table public.companies
  add constraint companies_currency_default
    check (default_currency = any (supported_currencies));
