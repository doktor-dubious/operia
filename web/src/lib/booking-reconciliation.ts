import type { TFunction } from 'i18next'
import { bookingTimeLabel } from '@/lib/booking'
import { formatMoney } from '@/lib/booking-services'
import type { ReportDoc } from '@/lib/reports/report-render'
import { supabase } from '@/lib/supabase'

// Afstemningsrapporten (EVU-krav E-02): den fulde kæde booking → kladde →
// fakturanummer, én række pr. booking pr. kladde.
//
// Kæden findes allerede: kladden kender sine bookinger gennem linjerne, og
// overførslen skriver fakturanummeret på kladden. Rapporten er en VISNING af
// den kæde — regnskabsadapteren (C-02) ændrer kun, hvor nummeret kommer fra.
//
// Perioden filtrerer på OVERFØRSELSDATOEN, ikke bookingdatoen: den, der
// afstemmer med kunden, kigger på "hvad blev faktureret i september", og en
// booking afholdt i august kan udmærket være faktureret i september.
// Kreditnotaer er med som negative rækker, så summen er det, kunden skylder.

export const RECON_MAX_ROWS = 2000

export type ReconLine = {
  id: string
  draft_id: string
  booking_id: string | null
  amount: number
  source: string
  draft: {
    id: string
    number: string
    kind: string
    status: string
    invoice_no: string | null
    external_system: string | null
    transferred_at: string | null
    approved_at: string | null
    credits_draft_id: string | null
    bill_to_name: string | null
  }
  booking: {
    id: string
    starts_at: string
    ends_at: string
    all_day: boolean
    title: string | null
    resource: { name: string } | null
    employee: { full_name: string | null; department: { name: string } | null } | null
  } | null
}

const SELECT = `id, draft_id, booking_id, amount, source,
  draft:invoice_drafts!invoice_draft_lines_draft_id_fkey (id, number, kind, status, invoice_no, external_system, transferred_at, approved_at, credits_draft_id, bill_to_name),
  booking:bookings (id, starts_at, ends_at, all_day, title, resource:booking_resources (name), employee:employees (full_name, department:departments (name)))`

export type ReconFilters = { from?: string; to?: string; status?: 'transferred' | 'open' }

export function validateReconSearch(raw: Record<string, unknown>): ReconFilters {
  const date = (k: string) => {
    const v = raw[k]
    return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined
  }
  const st = raw.status
  return { from: date('from'), to: date('to'), status: st === 'transferred' || st === 'open' ? st : undefined }
}

/** Én række pr. (kladde, booking) med beløbet summeret over linjerne. */
export type ReconRow = {
  /** (kladde, booking) — DataTable kræver et `id`. */
  id: string
  draft: ReconLine['draft']
  booking: ReconLine['booking']
  amount: number
  lines: number
}

export async function fetchReconRows(companyId: string, f: ReconFilters): Promise<ReconRow[]> {
  // Nyeste først, så loftet (RECON_MAX_ROWS) skærer de ældste linjer fra —
  // ikke et tilfældigt udsnit. Annullerede kladder filtreres i basen.
  const q = supabase
    .from('invoice_draft_lines')
    .select(SELECT.replace('draft:invoice_drafts!invoice_draft_lines_draft_id_fkey (', 'draft:invoice_drafts!invoice_draft_lines_draft_id_fkey!inner ('))
    .eq('company_id', companyId)
    .neq('draft.status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(RECON_MAX_ROWS)
  const { data, error } = await q
  if (error) throw error
  const lines = (data ?? []) as unknown as ReconLine[]
  // Periodegrænserne som lokale døgn (datovælgeren er lokal), sammenlignet
  // som tidspunkter — ikke som tekst mod et UTC-stempel.
  const localDay = (d: string, endOfDay: boolean) => {
    const [y, m, day] = d.split('-').map(Number)
    return endOfDay ? new Date(y, m - 1, day + 1).getTime() : new Date(y, m - 1, day).getTime()
  }
  const fromMs = f.from ? localDay(f.from, false) : null
  const toMs = f.to ? localDay(f.to, true) : null
  const byKey = new Map<string, ReconRow>()
  for (const l of lines) {
    if (!l.draft || l.draft.status === 'cancelled') continue
    if (f.status === 'transferred' && l.draft.status !== 'transferred') continue
    if (f.status === 'open' && l.draft.status === 'transferred') continue
    // Perioden: overført i perioden — eller, for åbne kladder, dannet/godkendt
    // i den. En åben kladde uden overførselsdato hører med, når den er åben nu.
    const stamp = l.draft.transferred_at ?? l.draft.approved_at
    const stampMs = stamp ? Date.parse(stamp) : NaN
    if (fromMs != null && Number.isFinite(stampMs) && stampMs < fromMs) continue
    if (toMs != null && Number.isFinite(stampMs) && stampMs >= toMs) continue
    const key = `${l.draft_id}:${l.booking_id ?? 'manual'}`
    const row = byKey.get(key) ?? { id: key, draft: l.draft, booking: l.booking, amount: 0, lines: 0 }
    row.amount += Number(l.amount ?? 0)
    row.lines += 1
    byKey.set(key, row)
  }
  return [...byKey.values()].sort((a, b) =>
    (b.draft.transferred_at ?? '').localeCompare(a.draft.transferred_at ?? '') || a.draft.number.localeCompare(b.draft.number),
  )
}

export function reconKpis(rows: ReconRow[]) {
  const k = { invoiced: 0, credited: 0, open: 0, drafts: new Set<string>(), bookings: new Set<string>() }
  for (const r of rows) {
    k.drafts.add(r.draft.id)
    if (r.booking) k.bookings.add(r.booking.id)
    if (r.draft.status !== 'transferred') k.open += r.amount
    else if (r.draft.kind === 'credit') k.credited += r.amount
    else k.invoiced += r.amount
  }
  return { ...k, net: k.invoiced + k.credited }
}

export function buildReconReport(opts: {
  rows: ReconRow[]
  filters: ReconFilters
  company: string
  currency: string
  lang: string
  t: TFunction
}): ReportDoc {
  const { rows, filters, company, currency, lang, t } = opts
  const k = reconKpis(rows)
  const fmt = (v: number) => formatMoney(v, currency, lang)
  const meta: string[] = []
  if (filters.from || filters.to)
    meta.push(t('bookingReport.pdf.period', { from: filters.from ?? t('bookingHistory.report.open'), to: filters.to ?? t('bookingHistory.report.open') }))
  meta.push(t('bookingHistory.report.rowCount', { count: rows.length }))
  meta.push(t('bookingHistory.report.generated', {
    date: new Intl.DateTimeFormat(lang.startsWith('en') ? 'en-GB' : 'da-DK', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Copenhagen' }).format(new Date()),
  }))
  const dt = (iso: string | null) => (iso ? new Intl.DateTimeFormat(lang.startsWith('en') ? 'en-GB' : 'da-DK', { dateStyle: 'short', timeZone: 'Europe/Copenhagen' }).format(new Date(iso)) : '—')
  return {
    title: t('bookingRecon.pdf.title'),
    company,
    metaLines: meta,
    footer: t('bookingRecon.pdf.footer'),
    sections: [
      { blocks: [{ kind: 'kpis', items: [
        { label: t('bookingRecon.kpiInvoiced'), value: fmt(k.invoiced) },
        { label: t('bookingRecon.kpiCredited'), value: fmt(k.credited) },
        { label: t('bookingRecon.kpiNet'), value: fmt(k.net) },
        { label: t('bookingRecon.kpiOpen'), value: fmt(k.open) },
        { label: t('bookingRecon.kpiDrafts'), value: String(k.drafts.size) },
      ] }] },
      { heading: t('bookingRecon.pdf.tableHeading'), blocks: [{ kind: 'table',
        columns: [t('bookingFlow.resource'), t('bookingPage.when'), t('bookingFlow.employee'), t('invoiceDrafts.number'), t('invoiceDrafts.statusLabel'), t('invoiceDrafts.invoiceNo'), t('bookingRecon.transferredAt'), t('bookingRecon.amount')],
        rows: rows.map((r) => [
          r.booking?.resource?.name ?? t('bookingRecon.manualLine'),
          r.booking ? bookingTimeLabel(r.booking) : '—',
          r.booking?.employee?.full_name ?? '—',
          r.draft.number + (r.draft.kind === 'credit' ? ` (${t('invoiceDrafts.creditNote')})` : ''),
          t(`invoiceDrafts.status.${r.draft.status}`),
          r.draft.invoice_no ?? '—',
          dt(r.draft.transferred_at),
          fmt(r.amount),
        ]) }] },
    ],
  }
}
