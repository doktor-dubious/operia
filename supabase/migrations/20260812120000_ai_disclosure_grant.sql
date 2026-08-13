-- Godkendelsen af AI-oplysningen skal være en HANDLING, ikke et felt i en
-- formular.
--
-- Fejlen i 20260812104500: stamp_ai_disclosure stemplede en ny godkendelse, når
-- 'disclosure_accepted' stod true i skrivningen — også når det var udbyderen,
-- der lige var skiftet. En klient (eller et script) kunne dermed flytte kunden
-- fra Anthropic i USA til DeepSeek i Kina og bære godkendelsen med over, uden
-- at nogen havde set et ord om den nye modtager. Beviset for kundens
-- dokumenterede instruks (art. 28) ville pege på en oplysning, kunden aldrig
-- havde fået.
--
-- Reglen herefter:
--   * En almindelig skrivning på tabellen kan kun BEVARE en godkendelse
--     (samme udbyder, samme tekstversion) eller FJERNE den. Aldrig give den.
--   * Godkendelse gives kun gennem accept_ai_disclosure(), som får at vide
--     HVAD kunden fik vist (udbyder + tekstversion) og afviser, hvis det ikke
--     passer med rækkens aktuelle udbyder og den gældende tekst.
--
-- Samme mønster som retention-oprydningen: funktionen sætter en
-- transaktions-lokal GUC, som triggeren kræver. En PostgREST-klient kan ikke
-- selv sætte den (hver forespørgsel er sin egen transaktion), så porten kan
-- kun åbnes indefra.

create or replace function public.stamp_ai_disclosure()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_granting boolean := coalesce(current_setting('operia.ai_disclosure', true), '') = 'grant';
begin
  -- Godkendelse gives (kun via accept_ai_disclosure).
  if v_granting and coalesce(new.disclosure_accepted, false) and new.provider is not null then
    new.disclosure_accepted := true;
    new.disclosure_accepted_at := now();
    new.disclosure_accepted_by := auth.uid();
    new.disclosure_version := public.ai_disclosure_version();
    new.disclosure_provider := new.provider;
    return new;
  end if;

  -- Bevar en gældende godkendelse: samme udbyder som den blev givet til, og
  -- samme tekstversion. Et gem af fx match_enabled må ikke flytte datoen for
  -- kundens instruks.
  if tg_op = 'UPDATE'
     and coalesce(new.disclosure_accepted, false)
     and old.disclosure_accepted
     and old.disclosure_provider is not distinct from new.provider
     and old.disclosure_version is not distinct from public.ai_disclosure_version() then
    new.disclosure_accepted_at := old.disclosure_accepted_at;
    new.disclosure_accepted_by := old.disclosure_accepted_by;
    new.disclosure_version := old.disclosure_version;
    new.disclosure_provider := old.disclosure_provider;
    return new;
  end if;

  -- Alt andet — herunder et forsøg på at bære godkendelsen med over til en ny
  -- udbyder — efterlader rækken uden godkendelse. Aflæsning er dermed slået
  -- fra, indtil kunden har set oplysningen igen og sagt ja.
  new.disclosure_accepted := false;
  new.disclosure_accepted_at := null;
  new.disclosure_accepted_by := null;
  new.disclosure_version := null;
  new.disclosure_provider := null;
  return new;
end;
$$;

-- SECURITY INVOKER med vilje: RLS-skrivepolitikken på company_ai_config
-- afgør, om kalderen er manager i virksomheden (eller platform-admin). Der er
-- derfor ingen adgangskontrol at gentage her — kun kontrollen af, at kunden
-- faktisk fik vist det, de siger ja til.
create or replace function public.accept_ai_disclosure(
  p_company_id uuid,
  p_provider text,
  p_version text
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_provider text;
  v_rows integer;
begin
  select provider into v_provider
  from public.company_ai_config
  where company_id = p_company_id;

  if v_provider is null then
    raise exception 'ai_not_configured' using errcode = 'check_violation';
  end if;
  -- Kunden skal have set oplysningen for DEN udbyder, der står på rækken …
  if v_provider is distinct from p_provider then
    raise exception 'ai_provider_mismatch' using errcode = 'check_violation';
  end if;
  -- … og i den tekstversion, der gælder nu.
  if p_version is distinct from public.ai_disclosure_version() then
    raise exception 'ai_disclosure_outdated' using errcode = 'check_violation';
  end if;

  perform set_config('operia.ai_disclosure', 'grant', true);
  update public.company_ai_config
  set disclosure_accepted = true
  where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  -- Nul rækker = RLS afviste skrivningen (ikke manager i virksomheden).
  if v_rows = 0 then
    raise exception 'ai_disclosure_denied' using errcode = 'insufficient_privilege';
  end if;
  perform set_config('operia.ai_disclosure', '', true);
end;
$$;

comment on function public.accept_ai_disclosure(uuid, text, text) is
  'Registrerer kundens bekræftelse af AI-oplysningen (art. 28: dokumenteret instruks). Afviser hvis udbyderen eller tekstversionen ikke er den, kunden fik vist. Tilbagetrækning sker ved at sætte disclosure_accepted = false direkte.';

revoke execute on function public.accept_ai_disclosure(uuid, text, text) from public, anon;
grant execute on function public.accept_ai_disclosure(uuid, text, text) to authenticated;
