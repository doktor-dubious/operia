-- Hvor længe må en håndterminal blive stående logget ind?
--
-- Håndterminalen genoptager sin gemte session ved appstart (supabase-kt), så
-- uden dette forbliver en terminal på bordet logget ind, indtil nogen trykker
-- Log ud. Med et vindue skal brugeren bekræfte sig igen efter X minutters
-- inaktivitet — med fingeraftryk hvis det er slået til, ellers adgangskode.
--
-- 0 = aldrig (nuværende adfærd). Bevidst som standard: værdien ændrer, hvornår
-- personalet pludselig bliver bedt om at logge ind igen, og det skal være et
-- aktivt valg frem for noget, en migration påfører alle kunder.
--
-- Platform sætter standarden; firma-kolonnen er null = arv (samme mønster som
-- login-metoderne og notifikationerne).

alter table public.platform_settings
  add column handheld_reauth_minutes integer not null default 0,
  add constraint platform_settings_handheld_reauth_nonneg
    check (handheld_reauth_minutes >= 0);

alter table public.companies
  add column handheld_reauth_minutes integer,
  add constraint companies_handheld_reauth_nonneg
    check (handheld_reauth_minutes is null or handheld_reauth_minutes >= 0);
