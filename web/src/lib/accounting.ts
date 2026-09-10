// Regnskabssystemer Operia kan integrere med. Katalog for Operia →
// Integrationer (hvad udbydes) og Konfigurér → Integrationer (hvad kunden
// vælger). Nøglerne skal matche check-constraint'en
// platform_settings_accounting_providers_check — en nøgle der kun findes her,
// afvises af databasen.
//
// Kun Visma e-conomic i dag; alternativer (Dinero, Business Central, …)
// tilføjes her og i constraint'en i samme migration.

export type AccountingProviderKey = 'economic'

export type AccountingProvider = {
  key: AccountingProviderKey
  label: string
  /** Hvor kunden henter sit adgangstoken — vises som hjælpelink. */
  tokenHelpUrl: string
  /** Hvor DCA opretter appen og henter sin app-hemmelighed. */
  developerUrl: string
}

export const ACCOUNTING_PROVIDERS: AccountingProvider[] = [
  {
    key: 'economic',
    label: 'Visma e-conomic',
    tokenHelpUrl: 'https://www.e-conomic.com/developer/connect',
    developerUrl: 'https://www.e-conomic.com/developer',
  },
]

export const ACCOUNTING_PROVIDER_KEYS = ACCOUNTING_PROVIDERS.map((p) => p.key)

export function accountingProvider(key: string | null | undefined): AccountingProvider | null {
  return ACCOUNTING_PROVIDERS.find((p) => p.key === key) ?? null
}
