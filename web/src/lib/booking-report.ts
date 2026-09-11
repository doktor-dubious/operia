import type { TFunction } from 'i18next'
import {
  BOOKING_COLUMNS,
  BOOKING_LIFECYCLE_KEYS,
  bookingLifecycle,
  bookingTimeLabel,
  type BookingHit,
  type BookingLifecycle,
} from '@/lib/booking'
import { formatMoney, linesTotal } from '@/lib/booking-services'
import type { ReportDoc } from '@/lib/reports/report-render'
import { supabase } from '@/lib/supabase'

// Bookingrapporten (EVU-krav E-01, E-03, E-04; navet for A-01, A-03, C-03, C-04).
//
// Kravet er "kombinerbare filtre: periode, lokale/ressource, afdeling eller
// kunde, bookingstatus, faktureringsstatus" — og at resultatet kan eksporteres.
// Filtrene ligger i URL'en, så en rapport er et link, man kan sende videre.
//
// Tre af dem afgrænser forespørgslen i basen (periode, ressource, afdeling —
// de skærer stort); to anvendes på det hentede udsnit (bookingstatus, som er
// tidens funktion og ikke findes som kolonne, og faktureringsstatus). Loftet
// er det samme som kalenderens: en rapport på 2.000 rækker er en rapport, man
// bør indsnævre, og skærmen siger det.
//
// "Kunde" findes ikke som begreb endnu — bookinger har en medarbejder, ikke en
// debitor (spørgsmål 3). Afdelingen ER der (via medarbejderen), og det er den,
// der filtreres på; debitor får sin egen vælger, når begrebet findes.

export const REPORT_MAX_ROWS = 2000

/** Faktureringsstatus som rapporten skelner — tre tilstande, ikke to. */
export type InvoiceState = 'none' | 'draft' | 'invoiced'

export type ReportRow = BookingHit & {
  employee: (BookingHit['employee'] & {
    department_id?: string | null
    department?: { id: string; name: string } | null
  }) | null
  draft: { id: string; number: string; status: string; invoice_no: string | null } | null
  service_lines: { quantity: number; unit_price: number | string; price_mode: string }[]
}

export const REPORT_EMBED = `${BOOKING_COLUMNS}, invoice_draft_id,
  resource:booking_resources (id, name, location, time_mode, is_active, category_id),
  employee:employees (id, full_name, initials, department_id, department:departments (id, name)),
  level:booking_participant_levels (id, name),
  draft:invoice_drafts!bookings_invoice_draft_id_fkey (id, number, status, invoice_no),
  service_lines:booking_service_lines (quantity, unit_price, price_mode)`

export type ReportFilters = {
  from?: string
  to?: string
  resource?: string
  department?: string
  status?: BookingLifecycle
  invoice?: InvoiceState
}

/** URL-parametrene som de kommer ind: ukendte værdier smides væk, ikke fejl. */
export function validateReportSearch(raw: Record<string, unknown>): ReportFilters {
  const str = (k: string) => (typeof raw[k] === 'string' && raw[k] ? (raw[k] as string) : undefined)
  const date = (k: string) => {
    const v = str(k)
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined
  }
  const status = str('status') as BookingLifecycle | undefined
  const invoice = str('invoice') as InvoiceState | undefined
  return {
    from: date('from'),
    to: date('to'),
    resource: str('resource'),
    department: str('department'),
    status: status && (BOOKING_LIFECYCLE_KEYS as Record<string, string>)[status] ? status : undefined,
    invoice: invoice && ['none', 'draft', 'invoiced'].includes(invoice) ? invoice : undefined,
  }
}

export async function fetchReportRows(companyId: string, f: ReportFilters): Promise<ReportRow[]> {
  // Afdelingsfilteret ligger på den indlejrede medarbejder; det kræver en
  // inner join, ellers ville bookinger uden medarbejder også komme med.
  const embed = f.department ? REPORT_EMBED.replace('employee:employees (', 'employee:employees!inner (') : REPORT_EMBED
  let q = supabase
    .from('bookings')
    .select(embed)
    .eq('company_id', companyId)
    .order('starts_at', { ascending: false })
    .limit(REPORT_MAX_ROWS)
  // Perioden er et OVERLAP: en booking, der starter før perioden og slutter i
  // den, hører med. Det er hvad "bookinger i marts" betyder for den, der spørger.
  if (f.from) q = q.gte('ends_at', new Date(`${f.from}T00:00:00`).toISOString())
  if (f.to) q = q.lte('starts_at', new Date(`${f.to}T23:59:59.999`).toISOString())
  if (f.resource) q = q.eq('resource_id', f.resource)
  if (f.department) q = q.eq('employee.department_id', f.department)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as unknown as ReportRow[]
}

export function invoiceState(r: ReportRow): InvoiceState {
  if (r.invoiced_at) return 'invoiced'
  if (r.draft && (r.draft.status === 'draft' || r.draft.status === 'approved')) return 'draft'
  return 'none'
}

/** De to klientside-filtre. */
export function applyRowFilters(rows: ReportRow[], f: ReportFilters, now = Date.now()): ReportRow[] {
  return rows.filter((r) => {
    if (f.status && bookingLifecycle(r, now) !== f.status) return false
    if (f.invoice && invoiceState(r) !== f.invoice) return false
    return true
  })
}

export const rowAmount = (r: ReportRow): number => linesTotal(r.service_lines ?? [])

export type ReportKpis = {
  total: number
  completedNotInvoiced: number
  onDraft: number
  invoiced: number
  cancelled: number
  amount: number
}

/**
 * Nøgletallene. `completedNotInvoiced` er det tal, C-04 og E-04 handler om:
 * afholdt, og ingen har faktureret det endnu.
 */
export function reportKpis(rows: ReportRow[], now = Date.now()): ReportKpis {
  const k: ReportKpis = { total: rows.length, completedNotInvoiced: 0, onDraft: 0, invoiced: 0, cancelled: 0, amount: 0 }
  for (const r of rows) {
    const life = bookingLifecycle(r, now)
    const inv = invoiceState(r)
    if (life === 'cancelled') k.cancelled += 1
    else {
      k.amount += rowAmount(r)
      if (inv === 'invoiced') k.invoiced += 1
      else if (inv === 'draft') k.onDraft += 1
      else if (life === 'completed') k.completedNotInvoiced += 1
    }
  }
  return k
}

export function invoiceStateLabel(r: ReportRow, t: TFunction): string {
  const st = invoiceState(r)
  if (st === 'invoiced') return r.draft?.invoice_no ? `${t('bookingReport.invoiced')} · ${r.draft.invoice_no}` : t('bookingReport.invoiced')
  if (st === 'draft') return `${t('bookingReport.onDraft')} · ${r.draft?.number ?? ''}`
  return t('bookingReport.notInvoiced')
}

/** Rapporten som ReportDoc til PDF (E-03) — samme tal og rækker som skærmen. */
export function buildBookingReport(opts: {
  rows: ReportRow[]
  filters: ReportFilters
  labels: { resource?: string; department?: string }
  company: string
  currency: string
  lang: string
  t: TFunction
}): ReportDoc {
  const { rows, filters, labels, company, currency, lang, t } = opts
  const k = reportKpis(rows)
  const meta: string[] = []
  if (filters.from || filters.to) {
    meta.push(t('bookingReport.pdf.period', {
      from: filters.from ?? t('bookingHistory.report.open'),
      to: filters.to ?? t('bookingHistory.report.open'),
    }))
  }
  if (labels.resource) meta.push(`${t('bookingFlow.resource')}: ${labels.resource}`)
  if (labels.department) meta.push(`${t('bookingReport.department')}: ${labels.department}`)
  if (filters.status) meta.push(`${t('bookingPage.status')}: ${t(BOOKING_LIFECYCLE_KEYS[filters.status])}`)
  if (filters.invoice) meta.push(`${t('bookingReport.invoiceStatus')}: ${t(`bookingReport.invoice.${filters.invoice}`)}`)
  meta.push(t('bookingHistory.report.rowCount', { count: rows.length }))
  meta.push(t('bookingHistory.report.generated', {
    date: new Intl.DateTimeFormat(lang.startsWith('en') ? 'en-GB' : 'da-DK', {
      dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Copenhagen',
    }).format(new Date()),
  }))

  return {
    title: t('bookingReport.pdf.title'),
    company,
    metaLines: meta,
    footer: t('bookingReport.pdf.footer'),
    sections: [
      {
        blocks: [
          {
            kind: 'kpis',
            items: [
              { label: t('bookingReport.kpiTotal'), value: String(k.total) },
              { label: t('bookingReport.kpiCompletedNotInvoiced'), value: String(k.completedNotInvoiced) },
              { label: t('bookingReport.kpiOnDraft'), value: String(k.onDraft) },
              { label: t('bookingReport.kpiInvoiced'), value: String(k.invoiced) },
              { label: t('bookingReport.kpiAmount'), value: formatMoney(k.amount, currency, lang) },
            ],
          },
        ],
      },
      {
        heading: t('bookingReport.pdf.tableHeading'),
        blocks: [
          {
            kind: 'table',
            columns: [
              t('bookingFlow.resource'),
              t('bookingPage.when'),
              t('bookingFlow.employee'),
              t('bookingReport.department'),
              t('bookingFlow.participants'),
              t('bookingPage.status'),
              t('bookingReport.invoiceStatus'),
              t('bookingReport.amount'),
            ],
            rows: rows.map((r) => [
              r.resource?.name ?? '—',
              bookingTimeLabel(r),
              r.employee?.full_name ?? '—',
              r.employee?.department?.name ?? '—',
              r.participant_count == null ? '—' : String(r.participant_count),
              t(BOOKING_LIFECYCLE_KEYS[bookingLifecycle(r)]),
              invoiceStateLabel(r, t),
              r.status === 'cancelled' ? '—' : formatMoney(rowAmount(r), currency, lang),
            ]),
          },
        ],
      },
    ],
  }
}
