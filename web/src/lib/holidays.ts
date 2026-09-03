import { toISODate } from '@/lib/calendar'

// Danske helligdage. Beregnes lokalt (ingen tabel, intet kald ud) — reglerne
// er faste og påskeafhængige, så et år kan udledes af årstallet alene.
//
// official = lukkedag efter helligdagslovgivningen. Grundlovsdag, juleaftens-
// og nytårsaftensdag er IKKE officielle helligdage, men de fleste danske
// arbejdspladser holder lukket eller halvt lukket — de markeres derfor
// diskret (som weekend) frem for som rød helligdag, så kalenderen ikke
// påstår mere end den ved.
//
// Store bededag er afskaffet fra og med 2024 (sidst holdt i 2023) og medtages
// derfor kun for tidligere år.

export type Holiday = {
  date: Date
  /** i18n-nøgle under bookingCalendar.holiday.* */
  key: string
  official: boolean
}

/** Påskesøndag (gregoriansk, Meeus/Jones/Butcher). */
function easterSunday(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day)
}

function plusDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

function holidaysForYear(year: number): Holiday[] {
  const easter = easterSunday(year)
  const list: Holiday[] = [
    { date: new Date(year, 0, 1), key: 'newYear', official: true },
    { date: plusDays(easter, -3), key: 'maundyThursday', official: true },
    { date: plusDays(easter, -2), key: 'goodFriday', official: true },
    { date: easter, key: 'easterSunday', official: true },
    { date: plusDays(easter, 1), key: 'easterMonday', official: true },
    { date: plusDays(easter, 39), key: 'ascension', official: true },
    { date: plusDays(easter, 49), key: 'whitSunday', official: true },
    { date: plusDays(easter, 50), key: 'whitMonday', official: true },
    { date: new Date(year, 11, 25), key: 'christmas', official: true },
    { date: new Date(year, 11, 26), key: 'boxingDay', official: true },
    // Ikke officielle helligdage, men i praksis lukkedage.
    { date: new Date(year, 5, 5), key: 'constitutionDay', official: false },
    { date: new Date(year, 11, 24), key: 'christmasEve', official: false },
    { date: new Date(year, 11, 31), key: 'newYearsEve', official: false },
  ]
  if (year < 2024) {
    list.push({ date: plusDays(easter, 26), key: 'prayerDay', official: true })
  }
  return list
}

const cache = new Map<number, Map<string, Holiday>>()

function yearMap(year: number): Map<string, Holiday> {
  let m = cache.get(year)
  if (!m) {
    m = new Map(holidaysForYear(year).map((h) => [toISODate(h.date), h]))
    cache.set(year, m)
  }
  return m
}

/** Helligdagen på datoen, eller null. */
export function holidayOn(d: Date): Holiday | null {
  return yearMap(d.getFullYear()).get(toISODate(d)) ?? null
}
