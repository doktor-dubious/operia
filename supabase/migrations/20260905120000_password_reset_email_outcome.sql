-- Log OM nulstillingsmailen faktisk kom af sted.
--
-- Hidtil kastede request-password-reset resultatet af sendResetEmail væk: en
-- manglende RESEND_API_KEY, et 403 fra Resend på et uverificeret afsenderdomæne
-- eller en netværksfejl gav præcis samme {ok:true} og præcis samme revisions-
-- række som en vellykket afsendelse. Kombineret med anti-enumereringen (svaret
-- er ALTID {ok:true}) var "mailen fejlede" dermed usynlig både i UI'et og i
-- loggen — man kunne kun konstatere at intet dukkede op i indbakken.
--
-- Nu bærer anmodningsrækken udfaldet:
--   email_sent  = true/false  (udeladt når ingen mail blev forsøgt, dvs. ukendt email)
--   email_error = maskeret fejltekst, kun ved email_sent=false
-- og en fejlet mail får level='error', så den fanges af niveaufiltret i Logs.
--
-- Edge-funktionen kalder nu RPC'en EFTER afsendelsen (i en finally, så
-- anmodningen stadig altid logges). De to nye parametre har default null, så
-- en endnu ikke gendeployet edge-funktion, der kalder med kun p_email, fortsat
-- rammer denne funktion og opfører sig som før.

-- Signaturændring ⇒ drop den gamle (1-parameter-)variant, ellers står de to
-- som overloads og PostgREST kan ikke afgøre hvilken et kald med kun p_email
-- mener.
drop function if exists public.log_password_reset_requested(text);

create or replace function public.log_password_reset_requested(
  p_email       text,
  p_email_sent  boolean default null,
  p_email_error text default null
)
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
  v_err        text;
  v_failed     boolean := p_email_sent is false;
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

  -- Fejlteksten kommer fra Resend og kan indeholde modtageradressen ("Invalid
  -- `to` field: ..."). Revisionsloggen er uforanderlig og skal holdes fri for
  -- PII (jf. GDPR-pakken), så adresser maskeres væk her — server-side, så en
  -- fremtidig kalder ikke kan glemme det — og teksten klippes til 200 tegn.
  v_err := nullif(
    left(regexp_replace(coalesce(p_email_error, ''), '[^@[:space:]]+@[^@[:space:]]+', '<email>', 'g'), 200),
    ''
  );

  -- 1) Globalt: højst 15 anmodning-poster pr. minut i alt.
  if (
    select count(*) from public.audit_log
    where action = 'auth.password_reset_requested'
      and created_at > now() - interval '1 minute'
  ) >= 15 then
    return;
  end if;

  -- 2) Pr. (maskeret) email: højst én pr. minut (dæmper gentagne forespørgsler).
  --    En FEJLET afsendelse er undtaget: den er hele pointen med at logge
  --    udfaldet, og må ikke kunne forsvinde bag dæmperen. Det globale loft
  --    ovenfor beskytter stadig loggen mod oversvømmelse.
  if not v_failed and exists (
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
    jsonb_build_object('method', 'email', 'unknown_email', v_unknown)
      || case
           when p_email_sent is null then '{}'::jsonb
           else jsonb_build_object('email_sent', p_email_sent)
         end
      || case
           when v_err is null then '{}'::jsonb
           else jsonb_build_object('email_error', v_err)
         end,
    v_user_id
  );
exception when others then
  null; -- logning må aldrig få nulstillings-flowet til at fejle
end;
$$;

revoke execute on function public.log_password_reset_requested(text, boolean, text) from public, anon, authenticated;
grant execute on function public.log_password_reset_requested(text, boolean, text) to service_role;

-- ---------------------------------------------------------------------------
-- Niveau: en fejlet nulstillingsmail er en driftsfejl, ikke en normal hændelse.
-- Uændret fra 20260904150000 bortset fra den ene nye gren. Signaturen (inkl.
-- `default null`) skal blive stående — audit_log.level er en genereret kolonne
-- oven på denne funktion.
-- ---------------------------------------------------------------------------
create or replace function public.audit_level(p_action text, p_detail jsonb default null)
returns text language sql immutable as $$
  select case
    when p_action = 'ai.label_read' then
      case
        when coalesce(p_detail->>'outcome', '') = 'ok' then 'success'
        when coalesce(p_detail->>'outcome', '') in (
          'integration_disabled', 'not_configured', 'not_allowed', 'not_accepted',
          'model_no_vision', 'forbidden', 'refused', 'image_too_large',
          'unsupported_media_type', 'rate_limited'
        ) then 'warning'
        else 'error'
      end
    when p_action = 'auth.password_reset_requested'
      and coalesce(p_detail->>'email_sent', '') = 'false' then 'error'
    when p_action = 'ai.disclosure_withdrawn' then 'warning'
    when p_action = 'parcel.removed'
      or p_action like '%.failed' or p_action like '%\_failed' escape '\'
      or p_action like '%.bounced' or p_action like '%\_bounced' escape '\'
      or p_action = 'data_transfer.spoof_rejected'
      then 'error'
    when p_action = 'import.rejected'
      or p_action = 'user.impersonated'
      or p_action like '%.deleted' or p_action like '%\_deleted' escape '\'
      or p_action like '%.deactivated'
      or p_action like '%.anonymized'
      or p_action like '%.removed'
      or p_action like '%.revoked'
      or p_action like '%.disabled'
      or p_action like '%.written\_off' escape '\'
      or p_action like '%.overridden' or p_action like '%\_overridden' escape '\'
      or p_action like '%.complained' or p_action like '%\_complained' escape '\'
      or p_action like '%\_deferred' escape '\'
      or (p_action = 'parcel.status_changed'
          and coalesce(p_detail->>'to_status', '') in ('rejected', 'returned', 'removed'))
      then 'warning'
    else 'success'
  end
$$;
