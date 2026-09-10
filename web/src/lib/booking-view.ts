// Bookingkalenderens tilstandsmodel: hvad er på skærmen, og hvad filtreres der på?
//
// Horisonten (hvilke døgn/timer der tegnes) har ÉN kilde: periodevælgeren
// skriver den, datofilteret skriver den, pilene flytter den. Derfor kan et
// datofilter og en "visning" ikke komme til at pege hver sin vej — noget der
// ellers er den klassiske fejl i den slags værktøjslinjer.
//
// Alt herinde er rent regnestykke uden tekst: kolonnerne kommer ud som datoer,
// og selve formateringen (og oversættelsen) sker i komponenten.

import {
  BOOKING_LIFECYCLES,
  type BookingHit,
  type BookingLifecycle,
} from '@/lib/booking'
import {
  addDays,
  diffDays,
  endOfDay,
  isISODate,
  startOfDay,
  startOfWeek,
  toISODate,
} from '@/lib/calendar'

export const BOOKING_VIEWS = ['timeline', 'calendar'] as const
export type BookingView = (typeof BOOKING_VIEWS)[number]

/** 'range' er den frie periode: datofilteret og finskrub med pilene lander her. */
export const BOOKING_PERIODS = ['day', 'week', 'month', 'range'] as const
export type BookingPeriod = (typeof BOOKING_PERIODS)[number]

/** Ressourcevælgerens to faste punkter over selve ressourcerne. */
export const RESOURCE_ALL = 'all'
export const RESOURCE_WITH_BOOKINGS = 'booked'

export type BookingStatusFilter = BookingLifecycle | 'any'

export type BookingCalendarSearch = {
  view?: BookingView
  period?: BookingPeriod
  date?: string
  from?: string
  to?: string
  resource?: string
  status?: BookingStatusFilter
  q?: string
}

/** Loft over en fri periode: en delt URL må ikke kunne bede om ti års gitter. */
export const MAX_SPAN_DAYS = 180
const MAX_QUERY_LEN = 100

function isOneOf<T extends string>(v: unknown, list: readonly T[]): v is T {
  return typeof v === 'string' && (list as readonly string[]).includes(v)
}

/** validateSearch for /booking/calendar: kun genkendte værdier slipper ind. */
export function validateBookingCalendarSearch(
  search: Record<string, unknown>,
): BookingCalendarSearch {
  const out: BookingCalendarSearch = {}
  if (isOneOf(search.view, BOOKING_VIEWS)) out.view = search.view
  if (isOneOf(search.period, BOOKING_PERIODS)) out.period = search.period
  if (isISODate(search.date)) out.date = search.date
  if (isISODate(search.from)) out.from = search.from
  if (isISODate(search.to)) out.to = search.to
  // Ressourcen er et id, vi kun sammenligner med — men den kommer fra URL'en,
  // så den skal have en længde, ikke bare en type.
  if (typeof search.resource === 'string' && search.resource.length <= 64)
    out.resource = search.resource
  if (search.status === 'any' || isOneOf(search.status, BOOKING_LIFECYCLES))
    out.status = search.status
  if (typeof search.q === 'string' && search.q.trim()) out.q = search.q.slice(0, MAX_QUERY_LEN)
  return out
}

export type Horizon = { start: Date; end: Date }

/** Det tegnede interval (hele døgn, begge inklusive) for en periode. */
export function bookingHorizon(
  period: BookingPeriod,
  anchor: Date,
  custom?: { from?: Date; to?: Date },
): Horizon {
  switch (period) {
    case 'day':
      return { start: startOfDay(anchor), end: startOfDay(anchor) }
    case 'week': {
      const monday = startOfWeek(anchor)
      return { start: monday, end: addDays(monday, 6) }
    }
    case 'month':
      return {
        start: new Date(anchor.getFullYear(), anchor.getMonth(), 1),
        end: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0),
      }
    case 'range': {
      const from = startOfDay(custom?.from ?? anchor)
      const raw = startOfDay(custom?.to ?? addDays(from, 6))
      const [start, end] = raw < from ? [raw, from] : [from, raw]
      return {
        start,
        end: diffDays(start, end) > MAX_SPAN_DAYS ? addDays(start, MAX_SPAN_DAYS) : end,
      }
    }
  }
}

/**
 * Pilene. De indre (‹ ›) skrubber ét døgn, de ydre (« ») flytter et helt trin.
 *
 * Et døgns skub kan ikke rummes i en uge eller en måned — vinduet ville stå
 * stille, indtil man tilfældigvis krydsede et skel. Finskrub låser derfor op i
 * en fri periode af samme længde; "I dag" (og et klik på Uge/Måned) snapper
 * tilbage.
 */
export function stepBooking(
  period: BookingPeriod,
  h: Horizon,
  unit: 'day' | 'period',
  dir: 1 | -1,
): BookingCalendarSearch {
  const span = diffDays(h.start, h.end) + 1
  if (unit === 'day') {
    if (period === 'day') return { period: 'day', date: toISODate(addDays(h.start, dir)) }
    return {
      period: 'range',
      from: toISODate(addDays(h.start, dir)),
      to: toISODate(addDays(h.end, dir)),
    }
  }
  switch (period) {
    case 'day':
      return { period: 'day', date: toISODate(addDays(h.start, 7 * dir)) }
    case 'week':
      return { period: 'week', date: toISODate(addDays(h.start, 7 * dir)) }
    case 'month':
      return {
        period: 'month',
        date: toISODate(new Date(h.start.getFullYear(), h.start.getMonth() + dir, 1)),
      }
    case 'range':
      return {
        period: 'range',
        from: toISODate(addDays(h.start, span * dir)),
        to: toISODate(addDays(h.end, span * dir)),
      }
  }
}

// --- Kolonner ---------------------------------------------------------------

export type TimelineColumn = {
  key: string
  /** Døgnet kolonnen hører til (også for timekolonner). */
  date: Date
  /** Timetal i dagsvisning; udeladt når kolonnen er et helt døgn. */
  hour?: number
  weekend: boolean
  today: boolean
}

/** Dagsvisningens standardvindue; udvides efter dagens egne bookinger. */
export const DAY_WINDOW = { from: 6, to: 20 }

/**
 * Timevinduet for dagsvisningen. Et fast 00–24 ville bruge halvdelen af
 * skærmen på nattetimer, så vi starter på arbejdsdagen og udvider kun, hvis
 * der faktisk ligger en booking uden for den.
 */
export function dayHourWindow(day: Date, bookings: BookingHit[]): { from: number; to: number } {
  const dayStart = startOfDay(day).getTime()
  const dayEnd = endOfDay(day).getTime()
  let from = DAY_WINDOW.from
  let to = DAY_WINDOW.to
  for (const b of bookings) {
    if (b.all_day) continue
    const s = new Date(b.starts_at).getTime()
    const e = new Date(b.ends_at).getTime()
    if (e <= dayStart || s > dayEnd) continue
    if (s >= dayStart) from = Math.min(from, new Date(s).getHours())
    else from = 0
    // Vægur, ikke millisekunder fra midnat: den dag uret stilles er døgnet 23
    // eller 25 timer langt, og en division ville lægge timekolonnerne skævt
    // i forhold til horizonBounds, der regner i lokale klokkeslæt.
    if (e <= dayEnd) {
      const end = new Date(e)
      to = Math.max(to, end.getHours() + (end.getMinutes() > 0 || end.getSeconds() > 0 ? 1 : 0))
    } else to = 24
  }
  return { from: Math.max(0, Math.min(from, 23)), to: Math.min(24, Math.max(to, from + 1)) }
}

/** Kolonnerne under datohovedet: timer i dagsvisning, ellers ét døgn ad gangen. */
export function timelineColumns(
  period: BookingPeriod,
  h: Horizon,
  hours: { from: number; to: number },
  today: Date,
): TimelineColumn[] {
  const todayISO = toISODate(today)
  if (period === 'day') {
    const isToday = toISODate(h.start) === todayISO
    const weekend = h.start.getDay() === 0 || h.start.getDay() === 6
    return Array.from({ length: hours.to - hours.from }, (_, i) => ({
      key: `h${hours.from + i}`,
      date: h.start,
      hour: hours.from + i,
      weekend,
      today: isToday,
    }))
  }
  const count = diffDays(h.start, h.end) + 1
  return Array.from({ length: count }, (_, i) => {
    const date = addDays(h.start, i)
    return {
      key: toISODate(date),
      date,
      weekend: date.getDay() === 0 || date.getDay() === 6,
      today: toISODate(date) === todayISO,
    }
  })
}

/** Horisonten i millisekunder — nævneren under bjælkernes venstre/bredde. */
export function horizonBounds(
  period: BookingPeriod,
  h: Horizon,
  hours: { from: number; to: number },
): { from: number; to: number } {
  if (period === 'day') {
    const d = h.start
    return {
      from: new Date(d.getFullYear(), d.getMonth(), d.getDate(), hours.from).getTime(),
      to: new Date(d.getFullYear(), d.getMonth(), d.getDate(), hours.to).getTime(),
    }
  }
  return { from: startOfDay(h.start).getTime(), to: addDays(h.end, 1).getTime() }
}

export type BarGeometry = {
  /** Procent af horisonten. */
  left: number
  width: number
  clipLeft: boolean
  clipRight: boolean
}

/**
 * Bjælkens plads i rækken, målt i tid frem for i kolonner: så rammer en
 * booking 08:30–12:15 præcis i dagsvisningen, mens uge/måned stadig ser ud
 * som hele døgn, fordi bookingerne dér i praksis er heldags.
 */
export function barGeometry(
  b: Pick<BookingHit, 'starts_at' | 'ends_at'>,
  bounds: { from: number; to: number },
): BarGeometry | null {
  const span = bounds.to - bounds.from
  if (span <= 0) return null
  const s = new Date(b.starts_at).getTime()
  const e = new Date(b.ends_at).getTime()
  if (e <= bounds.from || s >= bounds.to) return null
  const from = Math.max(s, bounds.from)
  const to = Math.min(e, bounds.to)
  return {
    left: ((from - bounds.from) / span) * 100,
    width: Math.max(((to - from) / span) * 100, 0.4),
    clipLeft: s < bounds.from,
    clipRight: e > bounds.to,
  }
}

// --- Filtrering -------------------------------------------------------------

/** Feltet søgningen leder i: ressource, medarbejder, formål og kursistniveau. */
export function bookingSearchText(b: BookingHit): string {
  return [
    b.resource?.name,
    b.resource?.location,
    b.employee?.full_name,
    b.employee?.initials,
    b.title,
    b.level?.name,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export function bookingMatches(b: BookingHit, q: string): boolean {
  if (!q) return true
  return bookingSearchText(b).includes(q)
}

/**
 * Fletter en ændring ind i URL'en. To regler holder adressen ærlig:
 * en fri periode bæres af from/til og de øvrige af en dato — aldrig begge —
 * og standardværdier skrives ikke, så en urørt side har en ren adresse.
 */
export function mergeBookingSearch(
  next: BookingCalendarSearch,
): (prev: BookingCalendarSearch) => BookingCalendarSearch {
  return (prev) => {
    const merged: BookingCalendarSearch = { ...prev, ...next }
    if ((merged.period ?? 'week') === 'range') delete merged.date
    else {
      delete merged.from
      delete merged.to
    }
    if (!merged.q?.trim()) delete merged.q
    if (merged.resource === RESOURCE_ALL) delete merged.resource
    if (merged.status === 'any') delete merged.status
    if (merged.view === 'timeline') delete merged.view
    if (merged.period === 'week' && !merged.date) delete merged.period
    return merged
  }
}
