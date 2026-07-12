// Sprog platformen kan udbyde (ISO 639-1) — vist med deres egne navne, så de
// er genkendelige uanset brugerfladens sprog. Bruges af Operia →
// Lokalisering (platformens udvalg) og Platform → Kunder (pr. virksomhed).
export const LANG_OPTIONS = [
  { code: 'da', name: 'Dansk' },
  { code: 'no', name: 'Norsk' },
  { code: 'sv', name: 'Svensk' },
  { code: 'de', name: 'Deutsch' },
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Français' },
]

// Katalogtekster (produkter/funktioner) ligger i DB med dansk som standard
// og engelsk i *_en-kolonnerne; vælg efter brugerfladens sprog.
type LocalizedCatalogRow = {
  name: string
  name_en: string | null
  description: string | null
  description_en: string | null
}

export function catalogName(row: LocalizedCatalogRow, uiLang: string) {
  return uiLang.startsWith('en') && row.name_en ? row.name_en : row.name
}

export function catalogDescription(row: LocalizedCatalogRow, uiLang: string) {
  return uiLang.startsWith('en') && row.description_en ? row.description_en : row.description
}
