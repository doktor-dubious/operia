// Skabelonkategorier til filteret på Operia → Skabeloner og
// Konfigurér → Skabeloner.
//
// Kategorien udledes af skabelonens NØGLE og står ikke i basen. Nøglerne er i
// forvejen produktpræfikser ('package_arrival', 'asset_expiry',
// 'booking_created'), fordi dispatcherne slår op på dem — så en kolonne ville
// være en ny sandhed at holde i sync med en, der allerede findes.
//
// Prisen er, at en skabelon med et nyt præfiks lander i 'other'. Den bliver
// altså aldrig SKJULT, kun grupperet et kedeligt sted, og filteret viser kun
// kategorier der faktisk har rækker — så en tom "Andet" dukker ikke op hos en
// kunde. Får produkterne engang navne der ikke kan læses ud af nøglen, er det
// her, en kolonne skal ind.

export const TEMPLATE_CATEGORIES = ['packages', 'assets', 'booking', 'other'] as const
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number]

/** Sentinel til Radix Select, som ikke tillader tomme værdier. */
export const ALL_TEMPLATE_CATEGORIES = 'all'

const PREFIX: [string, TemplateCategory][] = [
  ['package_', 'packages'],
  ['asset_', 'assets'],
  ['booking_', 'booking'],
]

export function templateCategory(key: string): TemplateCategory {
  return PREFIX.find(([p]) => key.startsWith(p))?.[1] ?? 'other'
}

export const TEMPLATE_CATEGORY_LABEL_KEY: Record<TemplateCategory, string> = {
  packages: 'templatesPage.categoryPackages',
  assets: 'templatesPage.categoryAssets',
  booking: 'templatesPage.categoryBooking',
  other: 'templatesPage.categoryOther',
}

/** Kategorier der faktisk har skabeloner — tomme valg vises ikke. */
export function presentCategories(keys: string[]): TemplateCategory[] {
  const present = new Set(keys.map(templateCategory))
  return TEMPLATE_CATEGORIES.filter((c) => present.has(c))
}
