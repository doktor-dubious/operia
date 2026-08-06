-- AI-integration: flere Gemini-modeller med gratis-tier, så en kunde kan vælge
-- en billigere/hurtigere model — og så testning ikke er bundet af ét models
-- døgnkvote (gratis-tier giver 20 kald pr. DØGN pr. model, ikke pr. minut).
--
-- Verificeret mod API'et 2026-08-06: alle tre kan læse billeder og understøtter
-- response_json_schema. BEMÆRK at de to sidste læste et sporingsnummer forkert
-- (sidste ciffer faldt væk) på testlabelen, hvor 3.5 Flash Lite ramte rigtigt —
-- de er derfor kun egnede til test/lav-risiko-brug, ikke til produktion hvor
-- sporingsnummeret er nøglen i track & trace.
--
-- gemini-3-pro-image er bevidst IKKE med: det er en billed-GENERERINGS-model
-- uden gratis-tier (429 ved første kald), ikke en OCR-model.
--
-- Kataloget er spejlet i web/src/lib/ai.ts, supabase/functions/ai-read-label/
-- index.ts og Repository.kt (AI_VISION_MODELS) — hold dem i sync med
-- constraints her.

alter table public.platform_settings
  drop constraint platform_settings_ai_models_check,
  add constraint platform_settings_ai_models_check
  check (ai_models <@ array[
    'claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5', 'claude-fable-5',
    'deepseek-chat', 'deepseek-reasoner',
    'gemini-3.6-flash', 'gemini-3.5-flash',
    'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview'
  ]::text[]);

alter table public.company_ai_config
  drop constraint company_ai_config_model_check,
  add constraint company_ai_config_model_check
  check (model in (
    'claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5', 'claude-fable-5',
    'deepseek-chat', 'deepseek-reasoner',
    'gemini-3.6-flash', 'gemini-3.5-flash',
    'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview'
  ));
