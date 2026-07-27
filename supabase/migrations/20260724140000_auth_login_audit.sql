-- NIS2-revisionslog: registrér logins (vellykkede OG fejlede) i public.audit_log.
--
-- Mekanisme: GoTrue's "password verification attempt"-hook. GoTrue kalder denne
-- funktion server-side ved HVERT password-tjek — både i web-appen, handheld-appen
-- og ved direkte API-kald — og oplyser om koden var korrekt (valid=true/false).
-- Klienten er utroværdig og kan derfor hverken springe logningen over eller
-- forfalske resultatet: kun GoTrue kalder hook'en, som authentikerings-serveren.
--
-- Hook'en aktiveres i supabase/config.toml under
-- [auth.hook.password_verification_attempt] (og kan alternativt slås til i
-- Dashboard → Authentication → Hooks). Uden aktivering er funktionen blot en
-- ubrugt definer-funktion — den skriver intet.
--
-- Bemærk: hook'en kaldes kun når GoTrue fandt en bruger at tjekke koden imod.
-- Forsøg på en ukendt email logges derfor ikke (der findes ingen bruger/konto at
-- knytte hændelsen til). Fejlede forsøg på EN EKSISTERENDE konto fanges — inkl.
-- deres company_id — hvilket er det sikkerhedsrelevante signal (kontooptagning).

-- ---------------------------------------------------------------------------
-- Hook-funktion. SECURITY DEFINER (kører som ejeren postgres), så den kan læse
-- auth.users/app_users og skrive i den ellers klient-lukkede audit_log.
--
-- KRITISK: en fejl her må ALDRIG blokere et login. GoTrue afviser login'et hvis
-- hook'en rejser en fejl, så hele kroppen er pakket i en exception-handler der
-- sluger alt og altid returnerer {"decision":"continue"}.
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- Maskering af login-emailen før den skrives i audit_log. Loggen er
-- UPDATE/DELETE-spærret, så en fuld emailadresse dér kan aldrig fjernes igen —
-- heller ikke ved en senere GDPR-anonymisering. Samme regel som maskRecipient
-- i supabase/functions/_shared/notify.ts (hold i sync): behold de første 1-2
-- tegn af local-part + domænet, resten bliver '*'.
-- ---------------------------------------------------------------------------
create or replace function public.mask_login_email(p_email text)
returns text
language sql
immutable
as $$
  select case
    when position('@' in coalesce(p_email, '')) < 2 then '****'
    else (
      select head || repeat('*', greatest(1, length(local_part) - length(head))) || '@' || domain_part
      from (
        select
          split_part(p_email, '@', 1) as local_part,
          substr(p_email, position('@' in p_email) + 1) as domain_part,
          substr(split_part(p_email, '@', 1), 1,
                 case when length(split_part(p_email, '@', 1)) <= 2 then 1 else 2 end) as head
      ) parts
    )
  end
$$;

revoke execute on function public.mask_login_email(text) from public, anon, authenticated;

create or replace function public.hook_password_verification_attempt(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id    uuid;
  v_valid      boolean;
  v_company_id uuid;
  v_email      text;
begin
  begin
    v_user_id := nullif(event->>'user_id', '')::uuid;
    v_valid   := coalesce((event->>'valid')::boolean, false);

    -- Virksomhed + email fra app_users; email falder tilbage på auth.users.
    select au.company_id, coalesce(nullif(au.email, ''), u.email)
      into v_company_id, v_email
    from auth.users u
    left join public.app_users au on au.user_id = u.id
    where u.id = v_user_id;

    perform public.record_audit(
      v_company_id,
      case when v_valid then 'auth.login' else 'auth.login_failed' end,
      'auth',
      v_user_id::text,
      public.mask_login_email(v_email),
      jsonb_build_object('valid', v_valid, 'method', 'password'),
      v_user_id
    );
  exception when others then
    -- Slug enhver fejl: logning må aldrig forhindre en bruger i at logge ind.
    null;
  end;

  return jsonb_build_object('decision', 'continue');
end;
$$;

-- Kun GoTrue (supabase_auth_admin) må kalde hook'en; klientroller holdes ude.
grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_password_verification_attempt(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_password_verification_attempt(jsonb) from authenticated, anon, public;

-- ---------------------------------------------------------------------------
-- Kategorisering: 'auth.*' hører til "Adgang & brugere" (samme som user.*).
-- Niveau håndteres allerede af audit_level ('%_failed' → 'error', ellers
-- 'success'), så login-fejl lyser rødt i Logs uden yderligere ændring.
-- Klient-spejlet er categoryOf i operia.logs.tsx — hold i sync.
-- ---------------------------------------------------------------------------
create or replace function public.audit_category(p_action text)
returns text language sql immutable as $$
  select case split_part(coalesce(p_action, ''), '.', 1)
    when 'parcel'         then 'parcels'
    when 'parcel_flow'    then 'parcels'
    when 'employee'       then 'directory'
    when 'department'     then 'directory'
    when 'location'       then 'config'
    when 'handling_class' then 'config'
    when 'carrier'        then 'config'
    when 'shipping'       then 'shipping'
    when 'agreement'      then 'shipping'
    when 'asset'          then 'assets'
    when 'asset_category' then 'assets'
    when 'asset_location' then 'assets'
    when 'assets'         then 'assets'
    when 'inventory_item' then 'inventory'
    when 'locker'         then 'lockers'
    when 'user'           then 'access'
    when 'auth'           then 'access'
    when 'product'        then 'entitlements'
    when 'feature'        then 'entitlements'
    when 'template'       then 'branding'
    when 'language'       then 'branding'
    when 'currency'       then 'branding'
    when 'appearance'     then 'branding'
    when 'product_text'   then 'branding'
    when 'home'           then 'branding'
    when 'maps'           then 'maps'
    when 'route'          then 'maps'
    when 'import'         then 'imports'
    when 'import_config'  then 'imports'
    when 'data_transfer'  then 'imports'
    when 'log_drain'      then 'log'
    when 'retention'      then 'log'
    else 'other'
  end
$$;

-- ---------------------------------------------------------------------------
-- Anden sti: forsøg på en UKENDT email. GoTrue's hook kaldes kun når en bruger
-- findes, så login-forsøg på en email uden konto fanges ikke af hook'en.
-- Klienten (web + handheld) rapporterer derfor hvert credential-fejl hertil.
-- Funktionen logger KUN når emailen ikke tilhører en eksisterende bruger —
-- eksisterende konti er allerede dækket af hook'en (undgå dubletter). Den
-- returnerer intet uanset udfald, så kaldet afslører ikke om kontoen findes
-- (ingen bruger-enumerering via svaret).
--
-- Kaldet er anonymt (login er endnu ikke lykkedes), så EXECUTE gives til anon.
-- record_audit kaldes internt som ejeren (postgres) — den for anon spærrede
-- helper er derfor stadig tilgængelig herfra.
-- ---------------------------------------------------------------------------
create or replace function public.log_failed_login_attempt(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email  text := lower(trim(coalesce(p_email, '')));
  v_masked text;
begin
  -- Ignorér tomt/ugyldigt input (støjbegrænsning).
  if v_email = '' or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    return;
  end if;

  -- Findes en bruger med denne email? Så har hook'en allerede logget forsøget.
  if exists (select 1 from auth.users where lower(email) = v_email) then
    return;
  end if;

  v_masked := public.mask_login_email(v_email);

  -- Flooddæmpning i to lag. Kaldet er anonymt og klient-drevet, og audit_log
  -- kan aldrig ryddes op — uden et GLOBALT loft kunne enhver med anon-nøglen
  -- fylde loggen permanent ved blot at rotere emails (per-email-tjekket alene
  -- stopper det ikke).
  -- 1) Globalt: højst 15 ukendt-email-poster pr. minut i alt.
  if (
    select count(*) from public.audit_log
    where action = 'auth.login_failed'
      and detail->>'unknown_email' = 'true'
      and created_at > now() - interval '1 minute'
  ) >= 15 then
    return;
  end if;

  -- 2) Pr. email: højst én post pr. (maskeret) email pr. minut.
  if exists (
    select 1 from public.audit_log
    where action = 'auth.login_failed'
      and summary = v_masked
      and created_at > now() - interval '1 minute'
  ) then
    return;
  end if;

  perform public.record_audit(
    null,                 -- ukendt konto ⇒ ingen virksomhed
    'auth.login_failed',
    'auth',
    null,
    v_masked,             -- aldrig den fulde email i den uforanderlige log
    jsonb_build_object('valid', false, 'method', 'password', 'unknown_email', true),
    null
  );
exception when others then
  null; -- logning må aldrig få kaldet til at fejle
end;
$$;

grant execute on function public.log_failed_login_attempt(text) to anon, authenticated;
