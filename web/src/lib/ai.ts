// Fælles katalog for AI-integrationen (Operia → Integrationer og Konfigurér →
// Integrationer). Nøglerne skal matche check-constraints i migrationerne
// 20260806163530_ai_integration.sql → 20260812150000_ai_mistral_ocr.sql og
// kataloget i edge-funktionen ai-read-label — en værdi der kun findes her,
// afvises af databasen/serveren.
//
// `vision` angiver om modellen kan læse billeder. Label-scanning kræver vision;
// modeller uden vision kan stadig vælges til fremtidige tekst-funktioner, men
// UI'et markerer at label-scanning ikke virker med dem.

export type AiProviderKey = 'mistral' | 'anthropic' | 'openai' | 'xai' | 'deepseek' | 'google'

export type AiProvider = {
  key: AiProviderKey
  /** Udbydernavne er egennavne — ens på alle sprog, derfor ingen i18n-nøgle. */
  label: string
  /**
   * Den juridiske enhed labelfotoet overføres TIL, og hvor den ligger. Bruges i
   * oplysningsteksten på Konfigurér → Integrationer: kunden er dataansvarlig og
   * skal kunne se hvilken databehandler og hvilket land de siger ja til.
   * `country` er en i18n-nøgle under companyAi.country.
   */
  vendor: string
  country: 'us' | 'cn' | 'fr'
  /**
   * Ligger udbyderen uden for EU/EØS? Afgør hvilken overførsels-sætning
   * oplysningsteksten viser — en overførsel til tredjeland kræver et
   * overførselsgrundlag, en behandling inden for EU/EØS gør ikke.
   */
  outsideEu: boolean
  /**
   * Har udbyderen et gratis niveau hvis vilkår tillader at det indsendte
   * bruges til modelforbedring? Så må DCA-nøglen til den udbyder KUN bruges
   * til udvikling og test med syntetiske labels — kundedata (rigtige
   * labelfotos) kræver en betalt plan med databehandleraftale.
   * Advarslen vises på Operia → Integrationer, hvor DCA vælger hvilke
   * udbydere kunderne overhovedet kan pege på. Se docs/gdpr/subprocessors.md.
   */
  hasFreeTier: boolean
}

export type AiModel = {
  key: string
  provider: AiProviderKey
  /** Modelnavne er produktnavne — ens på alle sprog. */
  label: string
  vision: boolean
}

export const AI_PROVIDERS: AiProvider[] = [
  // Mistral står først, fordi den er den eneste udbyder hvor labelfotoet bliver
  // i EU/EØS — det er det valg en dansk kunde skal møde først.
  // hasFreeTier: verificeret 2026-08-14. Mistrals "Experiment"-plan og Googles
  // Gemini-gratistier tillader begge at indsendt indhold bruges til
  // modelforbedring; Anthropic har intet gratis API-niveau (nøglen kræver
  // kredit fra første kald).
  { key: 'mistral', label: 'Mistral AI', vendor: 'Mistral AI SAS', country: 'fr', outsideEu: false, hasFreeTier: true },
  { key: 'anthropic', label: 'Anthropic', vendor: 'Anthropic PBC', country: 'us', outsideEu: true, hasFreeTier: false },
  { key: 'google', label: 'Google', vendor: 'Google LLC', country: 'us', outsideEu: true, hasFreeTier: true },
  { key: 'openai', label: 'OpenAI', vendor: 'OpenAI, L.L.C.', country: 'us', outsideEu: true, hasFreeTier: false },
  { key: 'xai', label: 'xAI', vendor: 'xAI Corp.', country: 'us', outsideEu: true, hasFreeTier: false },
  { key: 'deepseek', label: 'DeepSeek', vendor: 'DeepSeek', country: 'cn', outsideEu: true, hasFreeTier: false },
]

// Versionen af oplysningsteksten kunden bekræfter bor i databasen alene
// (public.ai_disclosure_version() — hæves i en migration når teksten ændres,
// hvorefter alle godkendelser skal gives på ny). Klienten HENTER versionen
// i stedet for at spejle den i en konstant: en konstant her ville drive fra
// SQL'en ved en ensidig bump, og så kunne et almindeligt gem stille trække en
// gyldig godkendelse tilbage (triggerens bevar-gren fejler på versionen).

export const aiProvider = (key: string): AiProvider | undefined =>
  AI_PROVIDERS.find((p) => p.key === key)

export const AI_MODELS: AiModel[] = [
  // Dedikeret dokument-/OCR-model, ikke en chatmodel: den læser labelen til
  // tekst og udfylder skemaet i ét kald (document_annotation).
  { key: 'mistral-ocr-latest', provider: 'mistral', label: 'Mistral OCR 4', vision: true },
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
