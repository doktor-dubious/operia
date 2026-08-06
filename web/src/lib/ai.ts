// Fælles katalog for AI-integrationen (Operia → Integrationer og Konfigurér →
// Integrationer). Nøglerne skal matche check-constraints i migrationen
// 20260806163530_ai_integration.sql og kataloget i edge-funktionen
// ai-read-label — en værdi der kun findes her, afvises af databasen/serveren.
//
// `vision` angiver om modellen kan læse billeder. Label-scanning kræver vision;
// modeller uden vision kan stadig vælges til fremtidige tekst-funktioner, men
// UI'et markerer at label-scanning ikke virker med dem.

export type AiProviderKey = 'anthropic' | 'openai' | 'xai' | 'deepseek' | 'google'

export type AiProvider = {
  key: AiProviderKey
  /** Udbydernavne er egennavne — ens på alle sprog, derfor ingen i18n-nøgle. */
  label: string
}

export type AiModel = {
  key: string
  provider: AiProviderKey
  /** Modelnavne er produktnavne — ens på alle sprog. */
  label: string
  vision: boolean
}

export const AI_PROVIDERS: AiProvider[] = [
  { key: 'anthropic', label: 'Anthropic' },
  { key: 'google', label: 'Google' },
  { key: 'openai', label: 'OpenAI' },
  { key: 'xai', label: 'xAI' },
  { key: 'deepseek', label: 'DeepSeek' },
]

export const AI_MODELS: AiModel[] = [
  { key: 'claude-haiku-4-5', provider: 'anthropic', label: 'Claude Haiku', vision: true },
  { key: 'claude-sonnet-5', provider: 'anthropic', label: 'Claude Sonnet', vision: true },
  { key: 'claude-opus-5', provider: 'anthropic', label: 'Claude Opus', vision: true },
  { key: 'claude-fable-5', provider: 'anthropic', label: 'Claude Fable', vision: true },
  { key: 'gemini-3.6-flash', provider: 'google', label: 'Gemini 3.6 Flash', vision: true },
  { key: 'gemini-3.5-flash', provider: 'google', label: 'Gemini 3.5 Flash', vision: true },
  { key: 'gemini-3.5-flash-lite', provider: 'google', label: 'Gemini 3.5 Flash Lite', vision: true },
  { key: 'gemini-3.1-flash-lite', provider: 'google', label: 'Gemini 3.1 Flash Lite', vision: true },
  { key: 'gemini-3-flash-preview', provider: 'google', label: 'Gemini 3 Flash (preview)', vision: true },
  { key: 'deepseek-chat', provider: 'deepseek', label: 'DeepSeek Chat', vision: false },
  { key: 'deepseek-reasoner', provider: 'deepseek', label: 'DeepSeek Reasoner', vision: false },
]

export function aiModelsFor(provider: string): AiModel[] {
  return AI_MODELS.filter((m) => m.provider === provider)
}
