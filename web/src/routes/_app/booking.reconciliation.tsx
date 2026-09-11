import { useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Download, Printer } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useCompany } from '@/components/company-provider'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { useCompanyContext } from '@/hooks/use-company-context'
import { bookingTimeLabel } from '@/lib/booking'
import { sanitizeFileName } from '@/lib/booking-export'
import {
  RECON_MAX_ROWS,
  buildReconReport,
  fetchReconRows,
  reconKpis,
  validateReconSearch,
  type ReconFilters,
  type ReconRow,
} from '@/lib/booking-reconciliation'
import { formatMoney, useCompanyCurrency } from '@/lib/booking-services'
import { dateStamp } from '@/lib/csv-export'
import { describeError } from '@/lib/errors'
import { renderCsv, renderPdf } from '@/lib/reports/report-render'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

// Booking → Afstemning (EVU-krav E-02): booking → kladde → fakturanummer, til
// afstemning med kunden. Perioden er overførselsperioden — se lib'en.
export const Route = createFileRoute('/_app/booking/reconciliation')({
  validateSearch: (raw: Record<string, unknown>) => validateReconSearch(raw),
  component: ReconciliationPage,
})

const ALL = '__all__'

function ReconciliationPage() {
  const { t, i18n } = useTranslation()
  const { companyId } = useCompanyContext()
  const { activeCompany } = useCompany()
  const currency = useCompanyCurrency(companyId)
  const navigate = useNavigate({ from: Route.fullPath })
  const filters = Route.useSearch()
  const [busy, setBusy] = useState(false)
  const [visible, setVisible] = useState<{ filtered: ReconRow[]; selected: ReconRow[] }>({ filtered: [], selected: [] })

  const setFilters = (patch: Partial<ReconFilters>) =>
    void navigate({ search: (prev: ReconFilters) => ({ ...prev, ...patch }), replace: true })

  const { data, isPending } = useQuery({
    queryKey: ['booking-recon', companyId, filters.from, filters.to, filters.status],
    enabled: !!companyId,
    queryFn: () => fetchReconRows(companyId!, filters),
  })
  const rows = data ?? []
  const kpis = useMemo(() => reconKpis(rows), [rows])
  const fmt = (v: number) => formatMoney(v, currency, i18n.language)
  const dt = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(i18n.language.startsWith('en') ? 'en-GB' : 'da-DK', { dateStyle: 'short', timeZone: 'Europe/Copenhagen' }).format(new Date(iso)) : '—'

  if (!companyId) return <Skeleton className="h-40 w-full" />

  const exportRows = visible.selected.length > 0 ? visible.selected : visible.filtered
  const doExport = async (format: 'csv' | 'pdf') => {
    if (exportRows.length === 0) {
      toast.error(t('bookingExport.nothingToExport'))
      return
    }
    setBusy(true)
    try {
      const doc = buildReconReport({ rows: exportRows, filters, company: activeCompany?.name ?? '', currency, lang: i18n.language, t })
      const base = sanitizeFileName(`operia-afstemning-${dateStamp()}`).replace(/\.csv$/i, '')
      if (format === 'pdf') await renderPdf(doc, base)
      else await renderCsv(doc, base)
      const { error } = await supabase.rpc('log_booking_export', {
        p_company_id: companyId,
        p_scope: 'report',
        p_rows: exportRows.length,
        p_detail: { shape: 'report', profile: format },
      })
      if (error) toast.warning(t('bookingExport.logFailed'))
      else toast.success(t('bookingExport.doneToast', { count: exportRows.length }))
    } catch (e) {
      toast.error(describeError(e as { message?: string }, t))
    } finally {
      setBusy(false)
    }
  }

  const columns: ColumnDef<ReconRow>[] = [
    { key: 'resource', header: t('bookingFlow.resource'), sortable: true,
      sortValue: (r) => r.booking?.resource?.name ?? '',
      render: (r) => r.booking?.resource?.name ?? <span className="text-muted-foreground">{t('bookingRecon.manualLine')}</span> },
    { key: 'time', header: t('bookingPage.when'), sortable: true,
      sortValue: (r) => r.booking?.starts_at ?? '',
      render: (r) => (r.booking ? bookingTimeLabel(r.booking) : '—') },
    { key: 'employee', header: t('bookingFlow.employee'), sortable: true,
      sortValue: (r) => r.booking?.employee?.full_name ?? '',
      render: (r) => r.booking?.employee?.full_name ?? '—' },
    { key: 'draft', header: t('invoiceDrafts.number'), sortable: true, sortValue: (r) => r.draft.number,
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="font-mono text-xs">{r.draft.number}</span>
          {r.draft.kind === 'credit' && (
            <Badge variant="secondary" className="bg-status-neutral-to-bad/15 text-status-neutral-to-bad">{t('invoiceDrafts.creditNote')}</Badge>
          )}
        </span>
      ) },
    { key: 'status', header: t('invoiceDrafts.statusLabel'), sortable: true, sortValue: (r) => r.draft.status,
      render: (r) => t(`invoiceDrafts.status.${r.draft.status}`),
      filter: { options: [...new Set(rows.map((r) => r.draft.status))].sort().map((v) => ({ value: v, label: t(`invoiceDrafts.status.${v}`) })), valueOf: (r) => r.draft.status } },
    { key: 'invoice_no', header: t('invoiceDrafts.invoiceNo'), sortable: true, sortValue: (r) => r.draft.invoice_no ?? '',
      render: (r) => r.draft.invoice_no ? <span className="font-mono text-xs">{r.draft.invoice_no}</span> : <span className="text-muted-foreground">—</span> },
    { key: 'transferred', header: t('bookingRecon.transferredAt'), sortable: true, sortValue: (r) => r.draft.transferred_at ?? '',
      render: (r) => dt(r.draft.transferred_at) },
    { key: 'amount', header: t('bookingRecon.amount'), sortable: true, sortValue: (r) => r.amount,
      render: (r) => <span className={cn('tabular-nums', r.amount < 0 && 'text-status-good')}>{fmt(r.amount)}</span> },
  ]

  return (
    <div className="flex min-h-full flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="rec-from" className="text-label">{t('bookingHistory.fromDate')}</Label>
          <Input id="rec-from" type="date" className="w-40" value={filters.from ?? ''} onChange={(e) => setFilters({ from: e.target.value || undefined })} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="rec-to" className="text-label">{t('bookingHistory.toDate')}</Label>
          <Input id="rec-to" type="date" className="w-40" value={filters.to ?? ''} onChange={(e) => setFilters({ to: e.target.value || undefined })} />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-label">{t('invoiceDrafts.statusLabel')}</Label>
          <Select value={filters.status ?? ALL} onValueChange={(v) => setFilters({ status: v === ALL ? undefined : (v as ReconFilters['status']) })}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('bookingRecon.statusAll')}</SelectItem>
              <SelectItem value="transferred">{t('bookingRecon.statusTransferred')}</SelectItem>
              <SelectItem value="open">{t('bookingRecon.statusOpen')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {(filters.from || filters.to || filters.status) && (
          <Button size="sm" variant="ghost" className="mb-0.5 text-muted-foreground hover:text-foreground" onClick={() => void navigate({ search: {}, replace: true })}>
            {t('bookingHistory.clearFilters')}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t('bookingRecon.periodHint')}</p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { k: 'kpiInvoiced', v: fmt(kpis.invoiced) },
          { k: 'kpiCredited', v: fmt(kpis.credited) },
          { k: 'kpiNet', v: fmt(kpis.net), strong: true },
          { k: 'kpiOpen', v: fmt(kpis.open), warn: kpis.open !== 0 },
          { k: 'kpiDrafts', v: `${kpis.drafts.size} / ${kpis.bookings.size}` },
        ].map((x) => (
          <div key={x.k} className="rounded-md border px-4 py-3">
            <p className="text-xs text-muted-foreground">{t(`bookingRecon.${x.k}`)}</p>
            <p className={cn('text-lg font-medium tabular-nums', x.warn && 'text-status-neutral-to-bad')}>{x.v}</p>
          </div>
        ))}
      </div>

      {rows.length >= RECON_MAX_ROWS && (
        <p className="text-xs text-status-neutral-to-bad">{t('bookingReport.capped', { count: RECON_MAX_ROWS })}</p>
      )}

      {isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          entityLabel={t('bookingRecon.entity')}
          searchText={(r) => `${r.booking?.resource?.name ?? ''} ${r.booking?.title ?? ''} ${r.booking?.employee?.full_name ?? ''} ${r.draft.number} ${r.draft.invoice_no ?? ''} ${r.draft.bill_to_name ?? ''}`}
          searchPlaceholder={t('bookingRecon.searchPlaceholder')}
          storageKey="booking-recon"
          toolbar={
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void doExport('csv')}><Download className="size-4" /> CSV</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void doExport('pdf')}><Printer className="size-4" /> PDF</Button>
            </div>
          }
          onVisibleRowsChange={setVisible}
        />
      )}
    </div>
  )
}
