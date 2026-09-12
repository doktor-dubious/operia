// Bookinger som CSV, serverside (EVU-krav B-02). Spejler web/src/lib/
// booking-export.ts — samme kolonnenøgler, samme to profiler, samme
// formatering — så en fil fra den planlagte eksport kan læses af det, der er
// sat op til den manuelle. De to filer kan ikke dele kode (web og Deno er
// hver sit træ); ændres kolonnerne det ene sted, skal de ændres det andet.
// Overskrifterne er nøglerne selv (Operia-profilens selvbeskrivende form).

export type Profile = 'operia' | 'excel_da'
export type Shape = 'bookings' | 'lines'

const PROFILE = {
  operia: { sep: ',', decimal: '.', dateFormat: 'iso' as const },
  excel_da: { sep: ';', decimal: ',', dateFormat: 'da' as const },
}

export const BOOKING_COLUMNS = [
  'booking_id', 'external_ref', 'status', 'resource', 'resource_location', 'employee', 'employee_initials',
  'purpose', 'starts_at', 'ends_at', 'all_day', 'days', 'participants', 'participant_level',
  'services_count', 'services_total', 'currency', 'invoiced_at', 'invoice_no', 'cancelled_at', 'created_at',
]
export const LINE_COLUMNS = [
  'booking_id', 'external_ref', 'resource', 'employee', 'starts_at', 'ends_at', 'service', 'vat_code', 'quantity',
  'unit_price', 'price_mode', 'line_total', 'currency',
]

export type BookingRow = {
  id: string
  external_ref: string | null
  status: string
  starts_at: string
  ends_at: string
  all_day: boolean
  title: string | null
  participant_count: number | null
  invoiced_at: string | null
  cancelled_at: string | null
  created_at: string
  resource: { name: string; location: string | null } | null
  employee: { full_name: string | null; initials: string | null } | null
  level: { name: string } | null
  draft: { invoice_no: string | null } | null
  service_lines: { quantity: number; unit_price: number; price_mode: string; service: { name: string; vat_code: string | null } | null }[]
}

export const BOOKING_CSV_SELECT = `id, external_ref, status, starts_at, ends_at, all_day, title, participant_count,
  invoiced_at, cancelled_at, created_at,
  resource:booking_resources (name, location),
  employee:employees (full_name, initials),
  level:booking_participant_levels (name),
  draft:invoice_drafts!bookings_invoice_draft_id_fkey (invoice_no),
  service_lines:booking_service_lines (quantity, unit_price, price_mode, service:booking_services (name, vat_code))`

function lifecycle(b: BookingRow, now = Date.now()): string {
  if (b.status === 'cancelled') return 'cancelled'
  if (b.invoiced_at) return 'invoiced'
  if (now < Date.parse(b.starts_at)) return 'booked'
  if (now >= Date.parse(b.ends_at)) return 'completed'
  return 'in_use'
}

function fmtDate(iso: string | null, f: 'iso' | 'da'): string {
  if (!iso) return ''
  const d = new Date(iso)
  const parts = new Intl.DateTimeFormat('da-DK', {
    timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d)
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return f === 'iso'
    ? `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`
    : `${g('day')}.${g('month')}.${g('year')} ${g('hour')}:${g('minute')}`
}

const amount = (v: number, dec: string) => (dec === ',' ? v.toFixed(2).replace('.', ',') : v.toFixed(2))
const lineTotal = (l: { quantity: number; unit_price: number; price_mode: string }) =>
  l.price_mode === 'total' ? Number(l.unit_price) : Number(l.unit_price) * (l.quantity ?? 1)
// Kalenderdage i dansk tid, halvåbent (slut eksklusiv) — samme tælling som
// basens booking_day_count med 'calendar' og web/src/lib/booking-export.ts'
// bookingDays: 00:00 → 00:00 næste dag er én dag, 22:00 → 02:00 er to.
const dayKey = (ms: number) => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(ms))
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  return Date.UTC(Number(g('year')), Number(g('month')) - 1, Number(g('day')))
}
const days = (b: BookingRow) => {
  const s = Date.parse(b.starts_at)
  const e = Date.parse(b.ends_at)
  if (!(e > s)) return 0
  return Math.max(1, Math.round((dayKey(e - 1) - dayKey(s)) / 86_400_000) + 1)
}

// Formel-injektion: samme regel som web/src/lib/csv-export.ts (escapeCsvCell).
// En celle, der begynder med = @ tab CR — eller + / - uden at være et tal —
// udføres af Excel/LibreOffice som formel, også i anførselstegn. Filen her
// sendes med e-mail til økonomi; en bookingtitel skrevet af en bruger med
// færre rettigheder må ikke blive til et HYPERLINK på modtagerens maskine.
const FORMULA_LEAD = /^[=@\t\r]/
const SIGNED_NUMBER = /^[+-][\d\s().,\-]*$/
function neutralizeFormula(s: string): string {
  if (s === '') return s
  if (FORMULA_LEAD.test(s)) return `'${s}`
  if ((s[0] === '+' || s[0] === '-') && !SIGNED_NUMBER.test(s)) return `'${s}`
  return s
}

function escape(v: unknown, sep: string): string {
  const s = v == null ? '' : neutralizeFormula(String(v))
  return s.includes(sep) || s.includes('"') || s.includes('\n') || s.includes('\r') ? `"${s.replace(/"/g, '""')}"` : s
}

export function bookingsCsv(rows: BookingRow[], shape: Shape, profile: Profile, currency: string): { csv: string; rows: number } {
  const p = PROFILE[profile]
  const out: string[][] = []
  if (shape === 'bookings') {
    out.push(BOOKING_COLUMNS)
    for (const b of rows) {
      const total = (b.service_lines ?? []).reduce((s, l) => s + lineTotal(l), 0)
      out.push([
        b.id, b.external_ref ?? '', lifecycle(b), b.resource?.name ?? '', b.resource?.location ?? '',
        b.employee?.full_name ?? '', b.employee?.initials ?? '', b.title ?? '',
        fmtDate(b.starts_at, p.dateFormat), fmtDate(b.ends_at, p.dateFormat), b.all_day ? '1' : '0', String(days(b)),
        b.participant_count == null ? '' : String(b.participant_count), b.level?.name ?? '',
        String((b.service_lines ?? []).length), amount(total, p.decimal), currency,
        fmtDate(b.invoiced_at, p.dateFormat), b.draft?.invoice_no ?? '', fmtDate(b.cancelled_at, p.dateFormat),
        fmtDate(b.created_at, p.dateFormat),
      ])
    }
  } else {
    out.push(LINE_COLUMNS)
    for (const b of rows) {
      for (const l of b.service_lines ?? []) {
        out.push([
          b.id, b.external_ref ?? '', b.resource?.name ?? '', b.employee?.full_name ?? '',
          fmtDate(b.starts_at, p.dateFormat), fmtDate(b.ends_at, p.dateFormat), l.service?.name ?? '', l.service?.vat_code ?? '',
          String(l.quantity), amount(Number(l.unit_price), p.decimal), l.price_mode, amount(lineTotal(l), p.decimal), currency,
        ])
      }
    }
  }
  const csv = '﻿' + out.map((r) => r.map((c) => escape(c, p.sep)).join(p.sep)).join('\r\n') + '\r\n'
  return { csv, rows: out.length - 1 }
}
