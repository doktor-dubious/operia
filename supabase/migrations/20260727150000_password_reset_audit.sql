-- Revisionslog for adgangskode-nulstilling (NIS2): to hændelser.
--   auth.password_reset_requested — et nulstillingslink er sendt (edge-funktionen
--     request-password-reset, som service_role, kalder log_password_reset_requested
--     når kontoen findes og mailen er sendt).
--   auth.password_reset — brugeren har faktisk sat en ny adgangskode på /welcome
--     (klienten kalder log_password_reset_done som den reautentificerede bruger).
--
-- record_audit er lukket for klientroller, så vi går via SECURITY DEFINER-RPC'er
-- (kører som ejeren postgres). Kun user_id + maskeret email logges (ingen fuld
-- PII i den uforanderlige log). 'auth.*' kategoriseres allerede som "Adgang".

-- ---------------------------------------------------------------------------
-- Anmodning: kaldes server-side af edge-funktionen (service_role) når linket
-- rent faktisk sendes. p_user_id kommer fra generateLink (kontoen findes).
-- ---------------------------------------------------------------------------
create or replace function public.log_password_reset_requested(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_email      text;
begin
  if p_user_id is null then
    return;
  end if;

  select au.company_id, coalesce(nullif(au.email, ''), u.email)
    into v_company_id, v_email
  from auth.users u
  left join public.app_users au on au.user_id = u.id
  where u.id = p_user_id;

  -- Højst én anmodning-post pr. bruger pr. minut (dæmp gentagne forespørgsler).
  if exists (
    select 1 from public.audit_log
    where action = 'auth.password_reset_requested'
      and actor_user_id = p_user_id
      and created_at > now() - interval '1 minute'
  ) then
    return;
  end if;

  perform public.record_audit(
    v_company_id,
    'auth.password_reset_requested',
    'auth',
    p_user_id::text,
    public.mask_login_email(v_email),
    jsonb_build_object('method', 'email'),
    p_user_id
  );
exception when others then
  null; -- logning må aldrig få nulstillings-flowet til at fejle
end;
$$;

revoke execute on function public.log_password_reset_requested(uuid) from public, anon, authenticated;
grant execute on function public.log_password_reset_requested(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Gennemført: kaldes af /welcome efter updateUser i reset-mode. Køres som den
-- netop reautentificerede bruger (auth.uid()).
-- ---------------------------------------------------------------------------
create or replace function public.log_password_reset_done()
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

  -- Højst én gennemført-post pr. bruger pr. minut.
  if exists (
    select 1 from public.audit_log
    where action = 'auth.password_reset'
      and actor_user_id = v_user_id
      and created_at > now() - interval '1 minute'
  ) then
    return;
  end if;

  perform public.record_audit(
    v_company_id,
    'auth.password_reset',
    'auth',
    v_user_id::text,
    public.mask_login_email(v_email),
    jsonb_build_object('method', 'recovery'),
    v_user_id
  );
exception when others then
  null;
end;
$$;

revoke execute on function public.log_password_reset_done() from public, anon;
grant execute on function public.log_password_reset_done() to authenticated;
