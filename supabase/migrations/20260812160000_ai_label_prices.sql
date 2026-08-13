-- Stykpriser for AI-labellæsning (Operia → Generelt, under notifikationspriserne).
-- Samme idé som cost_per_email/cost_per_sms i 20260730160000: forbruget står
-- allerede i revisionssporet (audit_log, action 'ai.label_read' — pr. kunde, med
-- model og udfald), så her kommer kun prisen pr. aflæsning.
--
-- Prisen sættes PR. MODEL, ikke pr. udbyder: udbydernes egne priser er
-- vidt forskellige pr. model (Mistral OCR 4 afregnes pr. side, Gemini/Claude pr.
-- token), og DCA's videresalgspris skal kunne følge det.
--
-- En jsonb-kolonne frem for en tabel, fordi nøglerne ER modelkataloget, som
-- allerede er hegnet af check-constraints ét sted (senest
-- 20260812150000_ai_mistral_ocr.sql) — en tabel ville betyde en ekstra kopi af
-- kataloget at holde i sync, samt egne RLS-politikker for det samme, der i
-- forvejen gælder platform_settings: alle må læse (prisen er ikke hemmelig for
-- den kunde der betaler den), kun platform-admins må skrive.
--
-- Beløb i DKK. Ingen skala-begrænsning her (jsonb-tal), men UI'et indtaster med
-- op til 4 decimaler ligesom SMS-prisen.

-- CHECK må ikke indeholde subqueries; validering ligger derfor i en immutable
-- funktion. Den håndhæver tre ting: objekt, kendt nøgleform, og et tal ≥ 0 —
-- så en fejlramt klient ikke kan lægge fri tekst eller negative priser i basen.
create or replace function public.ai_model_costs_valid(p jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(p) = 'object'
     and not exists (
       select 1 from jsonb_each(p) e
       where e.key !~ '^[a-z0-9._-]{1,48}$'
          or jsonb_typeof(e.value) <> 'number'
          or (e.value)::numeric < 0
     );
$$;

alter table public.platform_settings
  add column ai_model_costs jsonb not null default '{}'::jsonb;

alter table public.platform_settings
  add constraint platform_settings_ai_model_costs_check
  check (public.ai_model_costs_valid(ai_model_costs));

-- Prisændringer hører til i det samme spor som resten af AI-opsætningen.
-- Beløb er ikke persondata, så her må værdien gerne stå i loggen.
create or replace function public.audit_platform_ai()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.ai_enabled is distinct from old.ai_enabled
     or new.ai_providers is distinct from old.ai_providers
     or new.ai_models is distinct from old.ai_models then
    perform public.record_audit(null, 'ai.platform_changed', 'platform_settings', 'platform', null,
      jsonb_build_object('enabled', new.ai_enabled,
                         'providers', new.ai_providers,
                         'models', new.ai_models));
  end if;
  if new.ai_model_costs is distinct from old.ai_model_costs then
    perform public.record_audit(null, 'ai.prices_changed', 'platform_settings', 'platform', null,
      jsonb_build_object('costs', new.ai_model_costs));
  end if;
  return new;
end;
$$;
