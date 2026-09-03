// Fælles kalender-fundament for produkternes kalendersider (aktiver, booking):
// visningstyper + dato-hjælpere uden domæneviden. Al domænelogik (poster,
// hastighed/forfald, hentning) bor i produktets egen lib.

export const CALENDAR_VIEWS = ['day', 'week', 'month', 'year', 'custom'] as const
export type CalendarView = (typeof CALENDAR_VIEWS)[number]

export function isCalendarView(v: unknown): v is CalendarView {
  return typeof v === 'string' && (CALENDAR_VIEWS as readonly string[]).includes(v)
}

// --- Dato-hjælpere (lokale datoer; kalenderne regner i hele dage) -----------

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function isISODate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v))
}

export function parseISODate(v: string): Date {
  return new Date(`${v}T00:00:00`)
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

export function diffDays(from: Date, to: Date): number {
  // Rund fremfor at dividere råt: sommertid gør to døgn ± en time.
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000)
}

/** Det viste interval for en visning (start/slut som hele dage, begge inkl.). */
export function viewRange(
  view: CalendarView,
  anchor: Date,
  custom?: { from?: Date; to?: Date },
): { start: Date; end: Date } {
  switch (view) {
    case 'day':
      return { start: startOfDay(anchor), end: startOfDay(anchor) }
    case 'week': {
      // Dansk uge: mandag først.
      const monday = addDays(anchor, -((anchor.getDay() + 6) % 7))
      return { start: monday, end: addDays(monday, 6) }
    }
    case 'month':
      return {
        start: new Date(anchor.getFullYear(), anchor.getMonth(), 1),
        end: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0),
      }
    case 'year':
      return {
        start: new Date(anchor.getFullYear(), 0, 1),
        end: new Date(anchor.getFullYear(), 11, 31),
      }
    case 'custom': {
      const from = startOfDay(custom?.from ?? anchor)
      const to = startOfDay(custom?.to ?? addDays(from, 13))
      return to < from ? { start: to, end: from } : { start: from, end: to }
    }
  }
}

/** Skridtlængden for ◀/▶ pr. visning (custom flytter hele periodens længde). */
export function stepAnchor(view: CalendarView, anchor: Date, dir: 1 | -1, spanDays: number): Date {
  switch (view) {
    case 'day':
      return addDays(anchor, dir)
    case 'week':
      return addDays(anchor, 7 * dir)
    case 'month':
      return new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1)
    case 'year':
      return new Date(anchor.getFullYear() + dir, 0, 1)
    case 'custom':
      return addDays(anchor, spanDays * dir)
  }
}

// --- Ugenumre (ISO 8601: uge 1 er ugen med årets første torsdag) ------------

/** ISO-ugenummer (1–53). */
export function isoWeek(d: Date): number {
  // Flyt til torsdagen i samme uge; året for den torsdag ejer ugenummeret.
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7))
  const firstThursday = new Date(t.getFullYear(), 0, 4)
  firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7))
  return 1 + Math.round((t.getTime() - firstThursday.getTime()) / (7 * 86_400_000))
}

/** Mandagen i datoens uge (dansk uge starter mandag). */
export function startOfWeek(d: Date): Date {
  return addDays(startOfDay(d), -((d.getDay() + 6) % 7))
}

// --- Fælles kalender-chrome -------------------------------------------------
// Formatering og tegning der skal se ENS ud i alle produkternes kalendere.
// Lå tidligere som kopier i asset-calendar.tsx og booking-calendar.tsx, hvor
// de nåede at drive fra hinanden (se bookingTimeLabel i lib/booking.ts).

export const dayFormat = new Intl.DateTimeFormat('da-DK', { dateStyle: 'short' })
export const longDayFormat = new Intl.DateTimeFormat('da-DK', { dateStyle: 'full' })
export const monthFormat = new Intl.DateTimeFormat('da-DK', { month: 'long', year: 'numeric' })
export const monthShortFormat = new Intl.DateTimeFormat('da-DK', { month: 'short' })
export const weekdayFormat = new Intl.DateTimeFormat('da-DK', { weekday: 'short' })
export const weekdayNarrowFormat = new Intl.DateTimeFormat('da-DK', { weekday: 'narrow' })
export const timeFormat = new Intl.DateTimeFormat('da-DK', { hour: '2-digit', minute: '2-digit' })

/** da-DK formaterer med små bogstaver ("lørdag den …"); kun første bogstav op. */
export const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Takket kant på en bjælke: perioden fortsætter ud over visningens rand
 * (3 "tænder" i den ende der er klippet).
 */
export function jaggedClip(left: boolean, right: boolean): string | undefined {
  if (!left && !right) return undefined
  const j = '6px'
  const jr = `calc(100% - ${j})`
  const pts: string[] = [left ? `${j} 0` : '0 0']
  if (right) pts.push(`${jr} 0`, '100% 16%', `${jr} 33%`, '100% 50%', `${jr} 67%`, '100% 84%', `${jr} 100%`)
  else pts.push('100% 0', '100% 100%')
  pts.push(left ? `${j} 100%` : '0 100%')
  if (left) pts.push('0 84%', `${j} 67%`, '0 50%', `${j} 33%`, '0 16%')
  return `polygon(${pts.join(', ')})`
}

// --- Fælles URL-tilstand for kalendersiderne --------------------------------
// Visning + dato lever i URL'en, så en visning kan deles og tilbage-navigation
// virker. Rutefilerne for aktiv- og bookingkalenderen var ord for ord ens på
// nær komponentnavnet; her er delen uden JSX.

export type CalendarSearch = {
  view?: CalendarView
  date?: string
  from?: string
  to?: string
}

/** validateSearch for en kalenderrute: kun genkendte værdier slipper ind. */
export function validateCalendarSearch(search: Record<string, unknown>): CalendarSearch {
  const out: CalendarSearch = {}
  if (isCalendarView(search.view)) out.view = search.view
  if (isISODate(search.date)) out.date = search.date
  if (isISODate(search.from)) out.from = search.from
  if (isISODate(search.to)) out.to = search.to
  return out
}

/**
 * Fletter en navigation ind i den nuværende søgning: custom-perioden bæres af
 * from/til, alle andre visninger af view + dato — aldrig begge dele på én gang,
 * så en delt URL ikke rummer to modstridende perioder.
 */
export function mergeCalendarSearch(
  view: CalendarView,
  next: CalendarSearch,
): (prev: CalendarSearch) => CalendarSearch {
  return (prev) => {
    const merged = { ...prev, ...next }
    if ((next.view ?? view) !== 'custom') {
      delete merged.from
      delete merged.to
    } else {
      merged.view = 'custom'
      delete merged.date
    }
    return merged
  }
}
