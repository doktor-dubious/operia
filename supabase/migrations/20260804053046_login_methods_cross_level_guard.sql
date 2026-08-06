-- Lockout-værn PÅ TVÆRS af de to niveauer.
--
-- CHECK-constraints i 20260804044212 ser kun én række ad gangen: firma-checken
-- validerer mod "arv = true", ikke mod platformens faktiske værdi. Derfor kunne
-- to hver for sig gyldige ændringer tilsammen efterlade en virksomhed uden en
-- eneste login-metode:
--   1) Firma X slår biometri fra (eksplicit false — lovligt, adgangskode arves).
--   2) Platformen slår adgangskode fra globalt (lovligt, platformens biometri er til).
--   → Effektivt for X: adgangskode = false, biometri = true AND false = false.
-- Triggerne her fanger begge veje ind i den tilstand.

create or replace function public.assert_login_methods_available()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  offender text;
begin
  -- Effektiv værdi = platform AND coalesce(firma, true). Findes ét firma, hvor
  -- begge metoder ender som false, afvises ændringen.
  select c.name into offender
  from public.companies c
  cross join public.platform_settings ps
  where ps.id
    and not (ps.login_password_enabled and coalesce(c.login_password_enabled, true))
    and not (ps.login_biometric_enabled and coalesce(c.login_biometric_enabled, true))
  limit 1;

  if offender is not null then
    raise exception
      'Ændringen ville efterlade virksomheden "%" uden en eneste login-metode.', offender;
  end if;

  return null;
end;
$$;

-- AFTER + INITIALLY DEFERRED er bevidst: constraint-triggeren skal se den
-- færdige tilstand af BEGGE tabeller, så en transaktion, der lovligt flytter
-- en metode fra det ene niveau til det andet, ikke afvises undervejs.
create constraint trigger platform_settings_login_methods_guard
  after update on public.platform_settings
  deferrable initially deferred
  for each row execute function public.assert_login_methods_available();

create constraint trigger companies_login_methods_guard
  after insert or update on public.companies
  deferrable initially deferred
  for each row execute function public.assert_login_methods_available();
