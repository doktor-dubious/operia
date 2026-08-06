-- AI-integration: Google (Gemini) som tredje udbyder. Gemini 3.6/3.5 Flash kan
-- læse billeder og har gratis-tier — verificeret mod API'et 2026-08-06.
-- Kataloget er spejlet i web/src/lib/ai.ts, supabase/functions/ai-read-label/
-- index.ts og Repository.kt (AI_VISION_MODELS) — hold dem i sync med
-- constraints her. API-nøglen er edge-secret GEMINI_API.

alter table public.platform_settings
  drop constraint platform_settings_ai_providers_check,
  add constraint platform_settings_ai_providers_check
  check (ai_providers <@ array['anthropic', 'openai', 'xai', 'deepseek', 'google']::text[]);

alter table public.platform_settings
  drop constraint platform_settings_ai_models_check,
  add constraint platform_settings_ai_models_check
  check (ai_models <@ array[
    'claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5', 'claude-fable-5',
    'deepseek-chat', 'deepseek-reasoner',
    'gemini-3.6-flash', 'gemini-3.5-flash'
  ]::text[]);

alter table public.company_ai_config
  drop constraint company_ai_config_provider_check,
  add constraint company_ai_config_provider_check
  check (provider in ('anthropic', 'openai', 'xai', 'deepseek', 'google'));

alter table public.company_ai_config
  drop constraint company_ai_config_model_check,
  add constraint company_ai_config_model_check
  check (model in (
    'claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5', 'claude-fable-5',
    'deepseek-chat', 'deepseek-reasoner',
    'gemini-3.6-flash', 'gemini-3.5-flash'
  ));
