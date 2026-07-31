-- Vellykkede logins i revisionsloggen (auth.login), klient-drevet.
--
-- Ligesom fejlede logins (20260727130000) kunne vellykkede logins kun fanges af
-- GoTrue's password-verification-hook, som ikke er tilgængelig på projektets
-- plan. Derfor logger klienten (web + handheld) et vellykket login her, straks
-- efter at sign-in lykkedes.
--
-- Kaldet sker som den netop indloggede bruger (auth.uid()) — vi stoler på det,
-- fordi authentikeringen allerede lykkedes. Funktionen slår virksomhed + email
-- op på user_id og skriver 'auth.login' med maskeret email (ingen fuld PII i den
-- uforanderlige log).
--
-- Dedup/støjdæmpning: højst én auth.login pr. bruger pr. minut — dæmper gentagne
-- klient-kald (fx token-refresh der trigger et nyt kald) og deduplikerer mod
-- hook'en, hvis den nogensinde aktiveres på en understøttende plan.

create or replace function public.log_login_success()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id    uuid := auth.uid();
  v_company_id uuid;
  v_email      text;
begin
  if v_user_id is null then
    return;
  end if;

  select au.company_id, coalesce(nullif(au.email, ''), u.email)
    into v_company_id, v_email
  from auth.users u
  left join public.app_users au on au.user_id = u.id
  where u.id = v_user_id;

  -- Højst én auth.login pr. bruger pr. minut (dedup mod gentagne kald + hook).
  if exists (
    select 1 from public.audit_log
    where action = 'auth.login'
      and actor_user_id = v_user_id
      and created_at > now() - interval '1 minute'
  ) then
    return;
  end if;

  perform public.record_audit(
    v_company_id,
    'auth.login',
    'auth',
    v_user_id::text,
    public.mask_login_email(v_email),
    jsonb_build_object('valid', true, 'method', 'password'),
    v_user_id
  );
exception when others then
  null; -- logning må aldrig påvirke login-flowet
end;
$$;

revoke execute on function public.log_login_success() from public, anon;
grant execute on function public.log_login_success() to authenticated;
