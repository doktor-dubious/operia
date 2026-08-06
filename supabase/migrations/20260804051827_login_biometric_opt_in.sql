-- Biometrisk login er OPT-IN på platformsniveau.
--
-- Baggrund: web-siden af funktionen kræver ét skridt uden for denne kodebase —
-- Supabase Dashboard → Authentication → Passkeys skal slås til (CLI'ens
-- `config push` sender ikke feltet, verificeret 2026-08-04). Var flaget tændt
-- som standard, ville login-siden vise "Log ind med fingeraftryk" på et projekt,
-- hvor GoTrue afviser ceremonien — altså en knap, der kun kan fejle.
-- Derfor: slukket indtil en platform-admin bevidst tænder den, når Dashboard-
-- kontakten er sat. Håndterminalens biometri følger samme flag.

alter table public.platform_settings
  alter column login_biometric_enabled set default false;

update public.platform_settings
set login_biometric_enabled = false
where id;
