-- Stykpriser for udsendte notifikationer (Operia → Generelt): grundlaget for
-- at fakturere kunder pr. sendt e-mail/SMS. Selve forbruget står allerede i
-- parcel_notifications + asset_loan_notifications (append-only, pr. kunde, med
-- tidsstempel) — her kommer kun prisen pr. enhed, så forbrugsfanen på
-- Platform → Kunder kan regne beløb ud.
--
-- Priserne ligger i platform_settings (singleton) og er dermed læsbare for
-- alle brugere (RLS: using(true)) — det er accepteret: prisen er ikke
-- hemmelig for den kunde der betaler den. Kun platform-admins kan ændre.
-- Beløb i DKK; numeric(10,4) så SMS-priser i brøkdele af øre kan angives.
alter table public.platform_settings
  add column cost_per_email numeric(10,4) not null default 0 check (cost_per_email >= 0),
  add column cost_per_sms numeric(10,4) not null default 0 check (cost_per_sms >= 0);
