-- Fejllogin-audit uden GoTrue-hook'en.
--
-- Baggrund: GoTrue's password_verification_attempt-hook (20260724140000) er ikke
-- tilgængelig på projektets nuværende plan (Dashboard → Auth → Hooks er tom), så
-- fejlede logins på EKSISTERENDE konti blev aldrig logget: klienten kaldte godt
-- nok log_failed_login_attempt ved hver login-fejl, men funktionen sprang
-- eksisterende konti over (den regnede med at hook'en tog dem).
--
-- Rettelse: log ALLE fejlede forsøg klient-drevet (web + handheld kalder allerede
-- funktionen). Eksisterende konti attribueres med user_id + company_id; ukendte
-- emails logges med unknown_email=true og uden virksomhed.
--
-- Dubletsikring hvis hook'en senere aktiveres (Pro+): pr-email-loftet på 1/min
-- nedenfor fanger den anden skrivning (hook og klient bruger samme maskerede
-- summary), så man aldrig får to poster for samme forsøg.
--
-- Begrænsning: klient-drevet logning er "best effort" — et fejllogin via et
-- direkte API-kald (uden om vores apps) logges ikke. Det uafviselige, server-
-- side-signal kræver hook'en (dvs. en plan der understøtter den).

create or replace function public.log_failed_login_attempt(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email      text := lower(trim(coalesce(p_email, '')));
  v_masked     text;
  v_user_id    uuid;
  v_company_id uuid;
  v_unknown    boolean;
begin
  -- Ignorér tomt/ugyldigt input (støjbegrænsning).
  if v_email = '' or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    return;
  end if;

  -- Slå kontoen op (hvis den findes) for at attribuere forsøget. En manglende
  -- konto ⇒ unknown_email=true og ingen virksomhed. Svaret afslører intet om
  -- udfaldet, så der er ingen bruger-enumerering via kaldet.
  select u.id, au.company_id
    into v_user_id, v_company_id
  from auth.users u
  left join public.app_users au on au.user_id = u.id
  where lower(u.email) = v_email
  limit 1;
  v_unknown := v_user_id is null;

  v_masked := public.mask_login_email(v_email);

  -- Flooddæmpning i to lag (kaldet er anonymt og klient-drevet, og audit_log kan
  -- aldrig ryddes op):
  -- 1) Globalt: højst 15 fejllogin-poster pr. minut i alt.
  if (
    select count(*) from public.audit_log
    where action = 'auth.login_failed'
      and created_at > now() - interval '1 minute'
  ) >= 15 then
    return;
  end if;

  -- 2) Pr. (maskeret) email: højst én post pr. minut. Dette dæmper gentagne
  --    forsøg OG deduplikerer mod hook'en, hvis den nogensinde aktiveres.
  if exists (
    select 1 from public.audit_log
    where action = 'auth.login_failed'
      and summary = v_masked
      and created_at > now() - interval '1 minute'
  ) then
    return;
  end if;

  perform public.record_audit(
    v_company_id,
    'auth.login_failed',
    'auth',
    v_user_id::text,       -- null for ukendt email
    v_masked,              -- aldrig den fulde email i den uforanderlige log
    jsonb_build_object('valid', false, 'method', 'password', 'unknown_email', v_unknown),
    v_user_id
  );
exception when others then
  null; -- logning må aldrig få kaldet (og dermed login-UX'en) til at fejle
end;
$$;

grant execute on function public.log_failed_login_attempt(text) to anon, authenticated;
