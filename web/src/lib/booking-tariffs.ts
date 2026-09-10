// Prislisten (EVU-krav C-05) — den lille smule logik, både skærmen og
// kladdegenereringen i C-01 skal være enige om.
//
// Enhederne er bevidst flere, end kravet nævner: kunden har endnu ikke svaret
// på, om "dag" er kalenderdage eller hverdage, om timepris bruges, eller om
// kursistniveauet prissættes pr. person eller pr. person pr. dag. Alle svarene
// kan rummes som et valg i listen frem for som en ændring i koden.

import { toISODate } from '@/lib/calendar'

export type TariffScope = 'resource' | 'service' | 'level'

export const TARIFF_UNITS = ['day', 'hour', 'person', 'person_day', 'flat'] as const

export type TariffUnit = (typeof TARIFF_UNITS)[number]

export type TariffRow = {
  id: string
  scope: TariffScope
  unit: TariffUnit
  amount: number
  vat_code: string | null
  valid_from: string
  valid_to: string | null
  note: string | null
}

/** Gælder taksten på den dag? Tom slutdato = løbende. Dagen er den LOKALE
 *  dato (som resten af kalenderen), ikke UTC — mellem midnat og kl. 2 dansk
 *  tid er UTC stadig i går. */
export function isCurrentTariff(t: TariffRow, on?: string): boolean {
  const day = on ?? toISODate(new Date())
  return t.valid_from <= day && (t.valid_to === null || t.valid_to >= day)
}

/** Taksten der gælder for et mål på en dato, i en bestemt enhed. */
export function tariffOn(
  rows: TariffRow[],
  unit: TariffUnit,
  on: string,
): TariffRow | undefined {
  return rows.find((r) => r.unit === unit && isCurrentTariff(r, on))
}
