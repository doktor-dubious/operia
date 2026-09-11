import type { TFunction } from 'i18next'
import { BOOKING_LIFECYCLE_KEYS, type BookingLifecycle } from '@/lib/booking'
import { lineTotal } from '@/lib/booking-services'

// Bookinghistorikken (EVU-krav D-05), og den læsbare fremstilling af hver
// ændring (D-04).
//
// Hændelserne skrives af rækketriggeren `audit_bookings_row` og af
// ydelses-RPC'erne. De gemmer ID'ER, ikke navne — med vilje: navnet på en
// ressource kan ændre sig, og loggen skal vise hvad der SKETE, ikke hvad tingen
// hedder i dag. Prisen på en ydelseslinje gemmes derimod som tal i hændelsen,
// fordi den ER kendsgerningen: det beløb, ændringen flyttede.
//
// Oversættelsen fra id til navn sker derfor her, ved visningen, mod de aktuelle
// stamdata. Findes en ressource ikke længere, vises id'et forkortet frem for
// ingenting — en historik der taber en linje, er værre end en der er grim.

export type HistoryRow = {
  id: string
  booking_id: string
  event_type: string
  actor_user_id: string | null
  detail: Record<string, unknown>
  created_at: string
  booking: {
    id: string
    resource_id: string
    title: string | null
    starts_at: string
    ends_at: string
    resource: { name: string } | null
    employee: { full_name: string | null } | null
  } | null
}

export const HISTORY_SELECT = `id, booking_id, event_type, actor_user_id, detail, created_at,
  booking:bookings!inner (
    id, resource_id, title, starts_at, ends_at,
    resource:booking_resources (name),
    employee:employees (full_name)
  )`

/** Alle hændelsestyper triggeren og RPC'erne kan skrive — filtervalget. */
export const HISTORY_EVENT_TYPES = [
  'created',
  'updated',
  'cancelled',
  'invoiced',
  'invoice_cleared',
  'service_added',
  'service_updated',
  'service_removed',
] as const

/**
 * En aktør i sporet. `name` er null, når navnet ikke må vises for den, der
 * kigger: DCA's platform-administratorer optræder over for kunden som
 * organisationen og ikke som personer — se `audit_actor_names` i basen.
 */
export type Actor = { name: string | null; platform: boolean }

export type Lookups = {
  resources: Map<string, string>
  employees: Map<string, string>
  levels: Map<string, string>
  services: Map<string, string>
  users: Map<string, Actor>
}

export const emptyLookups = (): Lookups => ({
  resources: new Map(),
  employees: new Map(),
  levels: new Map(),
  services: new Map(),
  users: new Map(),
})

/**
 * Aktørens navn som det skal stå i en celle, en udskrift eller en søgning.
 *
 * Rækkefølgen er: navnet, ellers "DCA Logic" hvis det var platformen, ellers
 * "ukendt". Uden aktør-id er ændringen sket uden om brugerfladen — det er ikke
 * et hul i sporet, det ER oplysningen (D-02).
 */
export function actorLabel(id: string | null, lk: Lookups, t: TFunction): string {
  if (!id) return t('bookingHistory.systemActor')
  const a = lk.users.get(id)
  if (a?.name) return a.name
  if (a?.platform) return t('bookingHistory.platformActor')
  return t('bookingHistory.unknownUser')
}

/** Ukendt id: vis de første tegn frem for en tom celle. */
function fallbackId(id: string): string {
  return `${id.slice(0, 8)}…`
}

function nameOf(map: Map<string, string>, id: unknown): string {
  if (typeof id !== 'string' || !id) return '—'
  return map.get(id) ?? fallbackId(id)
}

function fmtDateTime(v: unknown, lang: string): string {
  if (typeof v !== 'string' || !v) return '—'
  const d = new Date(v)
  if (isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat(lang.startsWith('en') ? 'en-GB' : 'da-DK', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Europe/Copenhagen',
  }).format(d)
}

export type Change = { field: string; from: string; to: string }

/**
 * Hændelsens ændringer som læsbare før/efter-par (D-04).
 *
 * Fritekstfelterne står som "ændret" uden værdier: loggen gemmer dem bevidst
 * ikke, fordi audit_log er uforanderlig og videresendes til kundens log drains.
 * Det er en aftalt afvigelse fra kravets ordlyd — se docs/evu-booking-kravstatus.md.
 */
export function describeChanges(row: HistoryRow, lk: Lookups, t: TFunction, lang: string): Change[] {
  const d = row.detail ?? {}
  const out: Change[] = []
  const has = (k: string) => Object.prototype.hasOwnProperty.call(d, k)
  const pair = (key: string, field: string, fmt: (v: unknown) => string) => {
    if (has(`from_${key}`) || has(`to_${key}`)) {
      out.push({ field: t(field), from: fmt(d[`from_${key}`]), to: fmt(d[`to_${key}`]) })
    }
  }

  pair('resource_id', 'bookingFlow.resource', (v) => nameOf(lk.resources, v))
  pair('employee_id', 'bookingFlow.employee', (v) => nameOf(lk.employees, v))
  pair('starts_at', 'bookingHistory.fieldStart', (v) => fmtDateTime(v, lang))
  pair('ends_at', 'bookingHistory.fieldEnd', (v) => fmtDateTime(v, lang))
  pair('all_day', 'bookingHistory.fieldAllDay', (v) => t(v ? 'common.yes' : 'common.no'))
  pair('participant_count', 'bookingFlow.participants', (v) => (v == null ? '—' : String(v)))
  pair('participant_level_id', 'bookingFlow.level', (v) =>
    v == null ? '—' : nameOf(lk.levels, v),
  )
  pair('status', 'bookingPage.status', (v) =>
    typeof v === 'string' && v in BOOKING_LIFECYCLE_KEYS
      ? t(BOOKING_LIFECYCLE_KEYS[v as BookingLifecycle])
      : String(v ?? '—'),
  )
  pair('invoiced_at', 'bookingFlow.invoicedAt', (v) =>
    v == null ? '—' : fmtDateTime(v, lang),
  )
  pair('quantity', 'bookingServices.quantity', (v) => (v == null ? '—' : String(v)))

  // Fritekst: kun kendsgerningen (se hovedkommentaren).
  if (d.title_changed === true) {
    out.push({ field: t('bookingFlow.title'), from: '', to: t('bookingHistory.textChanged') })
  }
  if (d.reason_changed === true) {
    out.push({
      field: t('bookingFlow.cancelReason'),
      from: '',
      to: t('bookingHistory.textChanged'),
    })
  }

  // Ydelseslinjer: hvilken ydelse, og hvor mange.
  if (typeof d.service_id === 'string') {
    const qty = has('quantity') ? ` × ${String(d.quantity)}` : ''
    out.unshift({
      field: t('bookingServices.service'),
      from: '',
      to: `${nameOf(lk.services, d.service_id)}${qty}`,
    })
  }

  return out
}

/**
 * Hvad ændringen betød for fakturagrundlaget (D-04's beløbshalvdel).
 *
 * Tilkøb gøres op af deres egne, prissatte hændelser; lokale og kursister af
 * beløbet, triggeren skrev på hændelsen. Mangler begge dele (fx en ændring før
 * 2026-09-13, eller en booking uden takst), returneres null frem for 0: "ingen
 * beløbskonsekvens" og "kan ikke gøres op" er ikke det samme, og en 0-krone i
 * kolonnen ville påstå det første.
 */
export function amountDelta(row: HistoryRow): number | null {
  const d = row.detail ?? {}
  // Siden 2026-09-13 bærer bookinghændelserne selv, hvad ændringen betød for
  // lokale- og kursistlinjerne (amount_from/amount_to, regnet af triggeren på
  // taksterne som de gjaldt) — så en flyttet booking, et ændret kursistantal
  // eller en afbestilling kan gøres op i kroner, ikke kun tilkøbene.
  // Triggeren stripper null (jsonb_strip_nulls): en manglende side betyder
  // "kunne ikke prissættes", ikke 0 kroner. Så mangler én side, kan
  // ændringen ikke gøres op — og et ± på hele beløbet ville være forkert.
  if (d.amount_from !== undefined || d.amount_to !== undefined) {
    if (d.amount_from == null || d.amount_to == null) return null
    const from = Number(d.amount_from)
    const to = Number(d.amount_to)
    if (Number.isFinite(from) && Number.isFinite(to)) return to - from
  }
  const price = Number(d.unit_price ?? NaN)
  const mode = typeof d.price_mode === 'string' ? d.price_mode : null
  if (!Number.isFinite(price) || !mode) return null

  if (row.event_type === 'service_added') {
    return lineTotal({ quantity: Number(d.quantity ?? 1), unit_price: price, price_mode: mode })
  }
  if (row.event_type === 'service_removed') {
    return -lineTotal({ quantity: Number(d.quantity ?? 1), unit_price: price, price_mode: mode })
  }
  if (row.event_type === 'service_updated') {
    // Et fast beløb ændrer sig ikke af et andet antal.
    if (mode === 'total') return 0
    const from = Number(d.from_quantity ?? 0)
    const to = Number(d.to_quantity ?? 0)
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null
    return (to - from) * price
  }
  return null
}

/** Bookingens korte betegnelse i historikken: ressource + formål. */
export function bookingLabel(row: HistoryRow): string {
  const b = row.booking
  if (!b) return '—'
  return [b.resource?.name, b.title].filter(Boolean).join(' · ') || fallbackId(row.booking_id)
}

export function historySearchText(row: HistoryRow, lk: Lookups): string {
  return [
    bookingLabel(row),
    row.booking?.employee?.full_name,
    row.actor_user_id ? lk.users.get(row.actor_user_id)?.name : null,
    row.event_type,
    row.booking_id,
  ]
    .filter(Boolean)
    .join(' ')
}
