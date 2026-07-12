// Valutaer platformen kan udbyde (ISO 4217) — samme model som LANG_OPTIONS:
// Operia → Lokalisering vælger platformens udvalg; virksomhederne vælger
// blandt det. Vises som "navn, kortform, ticker" (fx "Danske kroner, kr., DKK").
export const CURRENCY_OPTIONS = [
  { code: 'DKK', shorthand: 'kr.', name: 'Danske kroner', name_en: 'Danish kroner' },
  { code: 'EUR', shorthand: '€', name: 'Euro', name_en: 'Euro' },
  { code: 'USD', shorthand: '$', name: 'Amerikanske dollar', name_en: 'US dollar' },
  { code: 'SEK', shorthand: 'kr.', name: 'Svenske kroner', name_en: 'Swedish kronor' },
  { code: 'NOK', shorthand: 'kr.', name: 'Norske kroner', name_en: 'Norwegian kroner' },
]

export type CurrencyOption = (typeof CURRENCY_OPTIONS)[number]

export function currencyLabel(currency: CurrencyOption, uiLang: string) {
  const name = uiLang.startsWith('en') ? currency.name_en : currency.name
  return `${name}, ${currency.shorthand}, ${currency.code}`
}
