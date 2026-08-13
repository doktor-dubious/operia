-- AI-labellæsning: Mistral (OCR 4) som udbyder nr. seks — og den første, hvor
-- labelfotoet ikke forlader EU/EØS. Mistral AI SAS er fransk, kører på
-- europæisk infrastruktur og er ikke omfattet af den amerikanske CLOUD Act, så
-- oplysningsteksten på Konfigurér → Integrationer viser en anden
-- overførsels-sætning for denne udbyder (web/src/lib/ai.ts: outsideEu = false).
--
-- 'mistral-ocr-latest' er en dokumentmodel, ikke en chatmodel: edge-funktionen
-- kalder POST /v1/ocr med document_annotation_format, så labelen læses til
-- tekst og felterne udfyldes i ét kald. API-nøglen er edge-secret MISTRAL_API.
--
-- BEMÆRK til driften: Mistrals GRATIS "Experiment"-plan tillader at
-- forespørgsler bruges til modeltræning. Den må derfor kun bruges til test med
-- syntetiske labels — en kunde må først sættes på Mistral, når nøglen hører
-- til en betalt plan. Samme forbehold som Geminis gratis-tier.
--
-- Kataloget er spejlet i web/src/lib/ai.ts, supabase/functions/ai-read-label/
-- index.ts, Repository.kt (AI_VISION_MODELS) og aiVendorLabel() i
-- ReceiveScreen.kt — hold dem i sync med constraints her.

alter table public.platform_settings
  drop constraint platform_settings_ai_providers_check,
  add constraint platform_settings_ai_providers_check
  check (ai_providers <@ array[
    'anthropic', 'openai', 'xai', 'deepseek', 'google', 'mistral'
  ]::text[]);

alter table public.platform_settings
  drop constraint platform_settings_ai_models_check,
  add constraint platform_settings_ai_models_check
  check (ai_models <@ array[
    'claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5', 'claude-fable-5',
    'deepseek-chat', 'deepseek-reasoner',
    'gemini-3.6-flash', 'gemini-3.5-flash',
    'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview',
    'mistral-ocr-latest'
  ]::text[]);

alter table public.company_ai_config
  drop constraint company_ai_config_provider_check,
  add constraint company_ai_config_provider_check
  check (provider in ('anthropic', 'openai', 'xai', 'deepseek', 'google', 'mistral'));

alter table public.company_ai_config
  drop constraint company_ai_config_model_check,
  add constraint company_ai_config_model_check
  check (model in (
    'claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5', 'claude-fable-5',
    'deepseek-chat', 'deepseek-reasoner',
    'gemini-3.6-flash', 'gemini-3.5-flash',
    'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview',
    'mistral-ocr-latest'
  ));
