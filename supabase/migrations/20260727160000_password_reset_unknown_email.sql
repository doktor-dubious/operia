-- Udvid nulstillings-anmodningsloggen til også at dække UKENDTE emails.
--
-- Tidligere (20260727150000) tog log_password_reset_requested et user_id og blev
-- kun kaldt når kontoen fandtes — forsøg på en ukendt email blev ikke logget.
-- Nu tager funktionen emailen (som log_failed_login_attempt), slår selv kontoen
-- op og logger begge tilfælde: kendt konto ⇒ attribueret + unknown_email=false;
-- ukendt email ⇒ ingen bruger/virksomhed + unknown_email=true.
--
-- Kaldet er service-side (edge-funktionen, service_role) og klient-drevet i sidste
-- ende, så to flood-lofter beskytter den uforanderlige log mod oversvømmelse:
-- globalt (15/min) og pr. maskeret email (1/min).

-- Signaturændring ⇒ drop den gamle (uuid-)variant først.
drop function if exists public.log_password_reset_requested(uuid);

create or replace function public.log_password_reset_requested(p_email text)
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
  if v_email = '' or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    return;
  end if;

  select u.id, au.company_id
    into v_user_id, v_company_id
  from auth.users u
  left join public.app_users au on au.user_id = u.id
  where lower(u.email) = v_email
  limit 1;
  v_unknown := v_user_id is null;

  v_masked := public.mask_login_email(v_email);

  -- 1) Globalt: højst 15 anmodning-poster pr. minut i alt.
  if (
    select count(*) from public.audit_log
    where action = 'auth.password_reset_requested'
      and created_at > now() - interval '1 minute'
  ) >= 15 then
    return;
  end if;

  -- 2) Pr. (maskeret) email: højst én pr. minut (dæmper gentagne forespørgsler).
  if exists (
    select 1 from public.audit_log
    where action = 'auth.password_reset_requested'
      and summary = v_masked
      and created_at > now() - interval '1 minute'
  ) then
    return;
  end if;

  perform public.record_audit(
    v_company_id,
    'auth.password_reset_requested',
    'auth',
    v_user_id::text,       -- null for ukendt email
    v_masked,
    jsonb_build_object('method', 'email', 'unknown_email', v_unknown),
    v_user_id
  );
exception when others then
  null; -- logning må aldrig få nulstillings-flowet til at fejle
end;
$$;

revoke execute on function public.log_password_reset_requested(text) from public, anon, authenticated;
grant execute on function public.log_password_reset_requested(text) to service_role;
