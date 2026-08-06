-- Login & sikkerhed: hvilke login-metoder er tilladt.
-- Platform-niveau (master switch) + firma-niveau (kan kun indsnævre, null = arv).
-- Effektiv værdi = platform AND coalesce(firma, true).
-- NB: flagene styrer UI-synlighed og enrollment — GoTrue kan ikke afvise
-- password-grant pr. firma på nuværende plan (password-verification-hook
-- er utilgængelig, jf. 20260724140000/config.toml).

alter table public.platform_settings
  add column login_password_enabled boolean not null default true,
  add column login_biometric_enabled boolean not null default true,
  add constraint platform_settings_login_method_required
    check (login_password_enabled or login_biometric_enabled);

alter table public.companies
  add column login_password_enabled boolean,
  add column login_biometric_enabled boolean,
  -- Et firma må ikke eksplicit slå begge metoder fra (lockout-værn).
  add constraint companies_login_method_required
    check (coalesce(login_password_enabled, true) or coalesce(login_biometric_enabled, true));

-- Login-siden skal kende platformens metoder FØR login (anon-rolle).
-- platform_settings har åben SELECT-RLS, men en dedikeret RPC holder
-- kontrakten eksplicit og minimal (ingen øvrige platformfelter til anon).
create or replace function public.get_login_options()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'password_enabled', ps.login_password_enabled,
    'biometric_enabled', ps.login_biometric_enabled
  )
  from public.platform_settings ps
  where ps.id
$$;

revoke all on function public.get_login_options() from public;
grant execute on function public.get_login_options() to anon, authenticated;
