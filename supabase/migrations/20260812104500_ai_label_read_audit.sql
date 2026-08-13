-- AI-label-læsning: revisionsspor pr. aflæsning + kundens dokumenterede
-- instruks (oplysning godkendt).
--
-- BAGGRUND (GDPR-gennemgang 2026-08-12)
-- Label-fotoet indeholder persondata (modtager og afsenders navn, adresse og
-- telefon) og sendes til en AI-udbyder uden for huset. Indtil nu blev SELVE
-- aflæsningen ikke logget nogen steder — kun konfigurationsændringer. Uden et
-- spor kan DCA og kunden ikke dokumentere HVORNÅR og FOR HVEM en overførsel
-- fandt sted (art. 30). Det lukkes her.
--
-- MINIMERINGSREGLEN (vigtigst i hele filen)
-- audit_log er UFORANDERLIG og videresendes til kundernes log-drains. Alt
-- personligt der lander her, kan aldrig slettes igen — hverken hos os eller hos
-- modtageren. Derfor logges KUN id'er og metadata: virksomhed, aktør, udbyder,
-- model, udfald, kilde, billedstørrelse, svartid og ANTALLET af udfyldte
-- felter. Aldrig de aflæste navne/adresser, aldrig billedet, aldrig udbyderens
-- fejltekst (den kan citere vores egen forespørgsel). Reglen håndhæves ikke med
-- en kommentar, men med funktionens signatur og validering nedenfor: der findes
-- ingen parameter man KAN putte fri tekst i.

-- ---------------------------------------------------------------------------
-- 1) Skrive-indgang for edge-funktionen
-- ---------------------------------------------------------------------------
-- Kun service_role (edge-funktionen ai-read-label) må kalde den — samme mønster
-- som record_audit/log_gateway_event: klienten kan hverken springe logningen
-- over eller forfalske den.
create or replace function public.record_ai_label_read(
  p_company_id uuid,
  p_actor uuid,
  p_provider text,
  p_model text,
  p_outcome text,
  p_source text default null,
  p_image_bytes integer default null,
  p_duration_ms integer default null,
  p_fields_found integer default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Hvert felt tvinges ned i et kendt, snævert format. En værdi der ikke ligner
  -- en maskinkode, bliver til 'unknown' frem for at blive skrevet — så kan et
  -- navn eller en adresse ikke smugles ind i loggen, uanset hvad kalderen
  -- sender.
  v_provider text := case when p_provider ~ '^[a-z0-9_-]{1,24}$' then p_provider else 'unknown' end;
  v_model    text := case when p_model    ~ '^[a-z0-9._-]{1,48}$' then p_model else 'unknown' end;
  v_outcome  text := case when p_outcome  ~ '^[a-z_]{1,32}$' then p_outcome else 'unknown' end;
  v_source   text := case when p_source in ('web', 'handheld') then p_source else 'unknown' end;
begin
  perform public.record_audit(
    p_company_id,
    'ai.label_read',
    'ai_label_read',
    -- Ingen entity_id: aflæsningen gemmes ingen steder (hverken billede eller
    -- svar), så der er ingen række at pege på. Og ingen summary: fri tekst er
    -- præcis dét, der ikke må stå her.
    null,
    null,
    jsonb_strip_nulls(jsonb_build_object(
      'provider', v_provider,
      'model', v_model,
      'outcome', v_outcome,
      'source', v_source,
      'image_bytes', greatest(coalesce(p_image_bytes, 0), 0),
      'duration_ms', greatest(coalesce(p_duration_ms, 0), 0),
      -- Antal udfyldte felter — ikke felterne selv. Nok til at se om en model
      -- pludselig svarer tomt, uden at fortælle hvad den læste.
      'fields_found', least(greatest(coalesce(p_fields_found, 0), 0), 99)
    )),
    p_actor
  );
end;
$$;

comment on function public.record_ai_label_read(uuid, uuid, text, text, text, text, integer, integer, integer) is
  'Logger én AI-label-aflæsning i audit_log (ai.label_read). KUN metadata: virksomhed, aktør, udbyder, model, udfald, kilde, størrelse, svartid, antal felter — aldrig aflæst indhold. Kaldes af edge-funktionen ai-read-label.';

revoke execute on function public.record_ai_label_read(uuid, uuid, text, text, text, text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.record_ai_label_read(uuid, uuid, text, text, text, text, integer, integer, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2) Kundens godkendelse af oplysningen (art. 28: dokumenteret instruks)
-- ---------------------------------------------------------------------------
-- Tilvalget fandtes allerede i to lag (platformens hovedafbryder + kundens valg
-- af udbyder/model). Det der manglede, var INDHOLDET: at kunden får at vide
-- hvilken udbyder, hvilket land og præcis hvad der sendes — og aktivt bekræfter
-- det. Afkrydsningen på Konfigurér → Integrationer er samtidig beviset for, at
-- DCA behandler på kundens dokumenterede instruks.
alter table public.company_ai_config
  add column disclosure_accepted boolean not null default false,
  -- Stemples SERVER-side (trigger nedenfor). Klienten må ikke kunne vælge
  -- tidspunkt, bruger eller version — ellers er beviset intet værd.
  add column disclosure_accepted_at timestamptz,
  add column disclosure_accepted_by uuid,
  add column disclosure_version text,
  add column disclosure_provider text;

comment on column public.company_ai_config.disclosure_accepted is
  'Kunden har bekræftet oplysningen om hvad der sendes til hvilken AI-udbyder. Uden den afviser ai-read-label aflæsningen (reason not_accepted).';
comment on column public.company_ai_config.disclosure_provider is
  'Den udbyder godkendelsen gjaldt. Skifter kunden udbyder, gælder godkendelsen ikke længere — den skal gives på ny.';

-- Versionen af oplysningsteksten. Ændres teksten væsentligt (ny udbyder, ny
-- datastrøm), hæves konstanten her, og alle godkendelser skal gives på ny.
-- Spejles i web/src/lib/ai.ts (AI_DISCLOSURE_VERSION) — hold dem i sync.
create or replace function public.ai_disclosure_version()
returns text language sql immutable as $$ select '2026-08-12'::text $$;

grant execute on function public.ai_disclosure_version() to authenticated;

-- Stempler godkendelsen server-side og rydder den, når den ikke længere gælder.
create or replace function public.stamp_ai_disclosure()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- En godkendelse uden et udbydervalg giver ingen mening — der er intet
  -- oplyst at godkende.
  if not coalesce(new.disclosure_accepted, false) or new.provider is null then
    new.disclosure_accepted := false;
    new.disclosure_accepted_at := null;
    new.disclosure_accepted_by := null;
    new.disclosure_version := null;
    new.disclosure_provider := null;
    return new;
  end if;

  if tg_op = 'INSERT'
     or not coalesce(old.disclosure_accepted, false)
     or old.disclosure_provider is distinct from new.provider
     or old.disclosure_version is distinct from public.ai_disclosure_version() then
    -- Ny godkendelse (eller en der skal fornys, fordi udbyderen/teksten er en
    -- anden end den, kunden sagde ja til).
    new.disclosure_accepted_at := now();
    new.disclosure_accepted_by := auth.uid();
    new.disclosure_version := public.ai_disclosure_version();
    new.disclosure_provider := new.provider;
  else
    -- Uændret godkendelse: behold det oprindelige stempel. Et gem af fx
    -- match_enabled må ikke flytte datoen for kundens instruks.
    new.disclosure_accepted_at := old.disclosure_accepted_at;
    new.disclosure_accepted_by := old.disclosure_accepted_by;
    new.disclosure_version := old.disclosure_version;
    new.disclosure_provider := old.disclosure_provider;
  end if;
  return new;
end;
$$;

create trigger company_ai_config_stamp_disclosure
  before insert or update on public.company_ai_config
  for each row execute function public.stamp_ai_disclosure();

-- Kolonnerettigheder: klienten må kun skrive sine egne valg. De stemplede
-- bevis-kolonner er server-ejede, og RLS kan ikke beskytte enkeltkolonner.
-- (company_id skal være med i UPDATE, fordi PostgREST' upsert sætter alle
-- kolonner i nyttelasten; RLS' with check binder den stadig til egen
-- virksomhed. Udvides nyttelasten i UI'et, skal kolonnen tilføjes her.)
revoke insert, update on public.company_ai_config from authenticated;
grant insert (company_id, provider, model, match_enabled, disclosure_accepted)
  on public.company_ai_config to authenticated;
grant update (company_id, provider, model, match_enabled, disclosure_accepted)
  on public.company_ai_config to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Revision af selve godkendelsen
-- ---------------------------------------------------------------------------
-- Godkendelse/tilbagetrækning logges som SELVSTÆNDIGE hændelser, ikke som en
-- detalje under 'ai.config_updated': det er dem, en art. 28-gennemgang leder
-- efter, og de skal kunne facetteres for sig i Logs.
create or replace function public.audit_company_ai_config()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.record_audit(old.company_id, 'ai.config_removed', 'ai_config',
      old.company_id::text, null,
      jsonb_build_object('provider', old.provider, 'model', old.model));
    return old;
  end if;

  if tg_op = 'INSERT' and new.disclosure_accepted then
    perform public.record_audit(new.company_id, 'ai.disclosure_accepted', 'ai_config',
      new.company_id::text, null,
      jsonb_build_object('provider', new.provider, 'model', new.model,
                         'version', new.disclosure_version));
  elsif tg_op = 'UPDATE' then
    if new.disclosure_accepted
       and (not old.disclosure_accepted
            or old.disclosure_provider is distinct from new.disclosure_provider
            or old.disclosure_version is distinct from new.disclosure_version) then
      perform public.record_audit(new.company_id, 'ai.disclosure_accepted', 'ai_config',
        new.company_id::text, null,
        jsonb_build_object('provider', new.provider, 'model', new.model,
                           'version', new.disclosure_version));
    elsif old.disclosure_accepted and not new.disclosure_accepted then
      perform public.record_audit(new.company_id, 'ai.disclosure_withdrawn', 'ai_config',
        new.company_id::text, null,
        jsonb_build_object('provider', old.disclosure_provider,
                           'version', old.disclosure_version));
    end if;
  end if;

  if tg_op = 'UPDATE'
     and new.provider is not distinct from old.provider
     and new.model is not distinct from old.model
     and new.match_enabled is not distinct from old.match_enabled then
    return new;
  end if;
  perform public.record_audit(new.company_id, 'ai.config_updated', 'ai_config',
    new.company_id::text, null,
    jsonb_build_object('provider', new.provider, 'model', new.model,
                       'match_enabled', new.match_enabled,
                       'disclosure_accepted', new.disclosure_accepted));
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Logs-taksonomi
-- ---------------------------------------------------------------------------
-- 'ai.*' faldt hidtil i 'other' sammen med alt ukendt. AI-hændelser er nu en
-- kategori for sig — det er dem en GDPR-gennemgang skal kunne trække ud alene.
-- Klient-spejlet er categoryOf i web/src/routes/_app/operia.logs.tsx.
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
    when 'ai'             then 'ai'
    else 'other'
  end
$$;

-- Niveau for en aflæsning følger UDFALDET, ikke handlingsnavnet:
--   ok                     → success
--   blokeret/afvist        → warning (systemet gjorde det rigtige)
--   teknisk fejl hos os/dem→ error
-- 'ai.disclosure_withdrawn' er en advarsel: kunden har trukket sin instruks
-- tilbage, og aflæsning er dermed slået fra.
-- Klient-spejlet er levelOf i web/src/routes/_app/operia.logs.tsx.
create or replace function public.audit_level(p_action text, p_detail jsonb)
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
    when p_action = 'ai.disclosure_withdrawn' then 'warning'
    when p_action = 'parcel.removed'
      or p_action like '%.failed' or p_action like '%\_failed' escape '\'
      or p_action like '%.bounced' or p_action like '%\_bounced' escape '\'
      or p_action = 'data_transfer.spoof_rejected'
      then 'error'
    when p_action = 'import.rejected'
      or p_action = 'user.impersonated'
      or p_action like '%.deleted'
      or p_action like '%.deactivated'
      or p_action like '%.anonymized'
      or p_action like '%.removed'
      or p_action like '%.revoked'
      or p_action like '%.disabled'
      or p_action like '%.written\_off' escape '\'
      or p_action like '%.overridden' or p_action like '%\_overridden' escape '\'
      or p_action like '%.complained' or p_action like '%\_complained' escape '\'
      or (p_action = 'parcel.status_changed'
          and coalesce(p_detail->>'to_status', '') in ('rejected', 'returned', 'removed'))
      then 'warning'
    else 'success'
  end
$$;

-- Genberegn de lagrede (generated) kolonner for rækker født under den gamle
-- definition — de hidtidige 'ai.*'-rækker står som 'other'. Samme fremgangsmåde
-- som 20260716100000: audit_log er append-only, indholdet ændres ikke, kun de
-- genererede kolonner, så triggeren slås fra i netop denne transaktion.
alter table public.audit_log disable trigger audit_log_immutable;
update public.audit_log set action = action
  where category is distinct from public.audit_category(action)
     or level is distinct from public.audit_level(action, detail);
alter table public.audit_log enable trigger audit_log_immutable;
