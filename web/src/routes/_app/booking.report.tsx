import { useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Download, FileText, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { BookingDetailPane } from '@/components/booking-detail-pane'
import { BookingExportDialog } from '@/components/booking-export-dialog'
import { InvoiceDraftGenerateDialog } from '@/components/invoice-draft-generate-dialog'
import { useCanManageBookings } from '@/components/booking-calendar'
import { useCompany } from '@/components/company-provider'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { useCompanyContext } from '@/hooks/use-company-context'
import {
  BOOKING_LIFECYCLES,
  BOOKING_LIFECYCLE_KEYS,
  bookingLifecycle,
  bookingLifecycleClass,
  bookingTimeLabel,
  invalidateBookingQueries,
  type BookingHit,
} from '@/lib/booking'
import { sanitizeFileName } from '@/lib/booking-export'
import {
  REPORT_MAX_ROWS,
  applyRowFilters,
  buildBookingReport,
  fetchReportRows,
  invoiceState,
  invoiceStateLabel,
  reportKpis,
  rowAmount,
  validateReportSearch,
  type ReportFilters,
  type ReportRow,
} from '@/lib/booking-report'
import { formatMoney, useCompanyCurrency } from '@/lib/booking-services'
import { dateStamp } from '@/lib/csv-export'
import { describeError } from '@/lib/errors'
import { renderPdf } from '@/lib/reports/report-render'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

// Booking → Rapport (EVU-krav E-01). Navet: A-01/A-03 åbner bookingen herfra,
// C-03 fakturerer det viste udvalg, C-04/E-04 er ét klik ("Afsluttet, ikke
// faktureret"), E-03 er de to eksportknapper.
//
// Filtrene bor i URL'en. En rapport, der kun findes i en komponents tilstand,
// kan ikke sendes til en kollega eller sættes som bogmærke — og "send mig lige
// den rapport" er, hvad rapporter bruges til.
export const Route = createFileRoute('/_app/booking/report')({
  validateSearch: (raw: Record<string, unknown>) => validateReportSearch(raw),
  component: ReportPage,
})

const ALL = '__all__'

function ReportPage() {
  const { t, i18n } = useTranslation()
  const { companyId } = useCompanyContext()
  const { activeCompany } = useCompany()
  const currency = useCompanyCurrency(companyId)
  const queryClient = useQueryClient()
  const navigate = useNavigate({ from: Route.fullPath })
  const filters = Route.useSearch()
  const canManage = useCanManageBookings()

  const [activeId, setActiveId] = useState<string | null>(null)
  const [paneDirty, setPaneDirty] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [invoiceOpen, setInvoiceOpen] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [visible, setVisible] = useState<{ filtered: ReportRow[]; selected: ReportRow[] }>({
    filtered: [],
    selected: [],
  })

  const setFilters = (patch: Partial<ReportFilters>) =>
    void navigate({ search: (prev: ReportFilters) => ({ ...prev, ...patch }), replace: true })

  const { data: resources } = useQuery({
    queryKey: ['booking-resources', 'options', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('booking_resources')
        .select('id, name')
        .eq('company_id', companyId!)
        .order('name')
      if (error) throw error
      return data ?? []
    },
  })
  const { data: departments } = useQuery({
    queryKey: ['departments', 'options', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('departments')
        .select('id, name')
        .eq('company_id', companyId!)
        .order('name')
      if (error) throw error
      return data ?? []
    },
  })

  // Serverside-delen af filtrene er nøglen; klientside-delen (status,
  // fakturering) anvendes på det hentede udsnit uden ny forespørgsel.
  const serverKey = [filters.from, filters.to, filters.resource, filters.department]
  const { data, isPending } = useQuery({
    queryKey: ['booking-report', companyId, ...serverKey],
    enabled: !!companyId,
    queryFn: () => fetchReportRows(companyId!, filters),
  })
  const rows = useMemo(() => applyRowFilters(data ?? [], filters), [data, filters])
  const kpis = useMemo(() => reportKpis(rows), [rows])

  const refresh = () => {
    invalidateBookingQueries(queryClient)
    void queryClient.invalidateQueries({ queryKey: ['booking-report', companyId] })
  }
  const guarded = (action: () => void) => {
    if (paneDirty) setPendingAction(() => action)
    else action()
  }

  if (!companyId) return <Skeleton className="h-40 w-full" />

  const resourceLabel = resources?.find((r) => r.id === filters.resource)?.name
  const departmentLabel = departments?.find((d) => d.id === filters.department)?.name
  const exportRows = visible.selected.length > 0 ? visible.selected : visible.filtered
  const activeRow = rows.find((r) => r.id === activeId) ?? null
  const preset = filters.status === 'completed' && filters.invoice === 'none'

  const exportPdf = async () => {
    if (exportRows.length === 0) {
      toast.error(t('bookingExport.nothingToExport'))
      return
    }
    setPdfBusy(true)
    try {
      const doc = buildBookingReport({
        rows: exportRows,
        filters,
        labels: { resource: resourceLabel, department: departmentLabel },
        company: activeCompany?.name ?? '',
        currency,
        lang: i18n.language,
        t,
      })
      await renderPdf(doc, sanitizeFileName(`operia-bookingrapport-${dateStamp()}`).replace(/\.csv$/i, ''))
      const { error } = await supabase.rpc('log_booking_export', {
        p_company_id: companyId,
        p_scope: 'report',
        p_rows: exportRows.length,
        p_detail: { shape: 'report', profile: 'pdf' },
      })
      if (error) toast.warning(t('bookingExport.logFailed'))
      else toast.success(t('bookingExport.doneToast', { count: exportRows.length }))
    } catch (e) {
      toast.error(describeError(e as { message?: string }, t))
    } finally {
      setPdfBusy(false)
    }
  }

  const columns: ColumnDef<ReportRow>[] = [
    {
      key: 'resource',
      header: t('bookingFlow.resource'),
      sortable: true,
      sortValue: (b) => b.resource?.name ?? '',
      render: (b) => b.resource?.name ?? '—',
    },
    {
      key: 'time',
      header: t('bookingPage.when'),
      sortable: true,
      sortValue: (b) => b.starts_at,
      render: (b) => bookingTimeLabel(b),
    },
    {
      key: 'employee',
      header: t('bookingFlow.employee'),
      sortable: true,
      sortValue: (b) => b.employee?.full_name ?? '',
      render: (b) => b.employee?.full_name ?? '—',
    },
    {
      key: 'department',
      header: t('bookingReport.department'),
      sortable: true,
      sortValue: (b) => b.employee?.department?.name ?? '',
      render: (b) => b.employee?.department?.name ?? '—',
      filter: {
        options: [...new Set(rows.map((b) => b.employee?.department?.name).filter(Boolean) as string[])]
          .sort()
          .map((v) => ({ value: v, label: v })),
        valueOf: (b) => b.employee?.department?.name ?? '',
      },
    },
    {
      key: 'participants',
      header: t('bookingFlow.participants'),
      sortable: true,
      sortValue: (b) => b.participant_count ?? -1,
      render: (b) => (b.participant_count == null ? '—' : String(b.participant_count)),
    },
    {
      key: 'status',
      header: t('bookingPage.status'),
      sortable: true,
      sortValue: (b) => BOOKING_LIFECYCLES.indexOf(bookingLifecycle(b)),
      render: (b) => {
        const stage = bookingLifecycle(b)
        return <span className={bookingLifecycleClass(stage)}>{t(BOOKING_LIFECYCLE_KEYS[stage])}</span>
      },
    },
    {
      key: 'invoice',
      header: t('bookingReport.invoiceStatus'),
      sortable: true,
      sortValue: (b) => invoiceState(b),
      render: (b) =>
        b.status === 'cancelled' ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className={cn(invoiceState(b) === 'none' && bookingLifecycle(b) === 'completed' && 'text-status-neutral-to-bad')}>
            {invoiceStateLabel(b, t)}
          </span>
        ),
    },
    {
      key: 'amount',
      header: t('bookingReport.amount'),
      sortable: true,
      sortValue: (b) => rowAmount(b),
      render: (b) =>
        b.status === 'cancelled' ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="tabular-nums">{formatMoney(rowAmount(b), currency, i18n.language)}</span>
        ),
    },
  ]

  return (
    <div className="flex min-h-full flex-col gap-6">
      {/* ── Filtre (E-01) ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="rep-from" className="text-label">{t('bookingHistory.fromDate')}</Label>
          <Input id="rep-from" type="date" className="w-40" value={filters.from ?? ''}
            onChange={(e) => setFilters({ from: e.target.value || undefined })} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="rep-to" className="text-label">{t('bookingHistory.toDate')}</Label>
          <Input id="rep-to" type="date" className="w-40" value={filters.to ?? ''}
            onChange={(e) => setFilters({ to: e.target.value || undefined })} />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-label">{t('bookingFlow.resource')}</Label>
          <Select value={filters.resource ?? ALL} onValueChange={(v) => setFilters({ resource: v === ALL ? undefined : v })}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('bookingReport.allResources')}</SelectItem>
              {(resources ?? []).map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-label">{t('bookingReport.department')}</Label>
          <Select value={filters.department ?? ALL} onValueChange={(v) => setFilters({ department: v === ALL ? undefined : v })}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('bookingReport.allDepartments')}</SelectItem>
              {(departments ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-label">{t('bookingPage.status')}</Label>
          <Select value={filters.status ?? ALL} onValueChange={(v) => setFilters({ status: v === ALL ? undefined : (v as ReportFilters['status']) })}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('bookingReport.allStatuses')}</SelectItem>
              {BOOKING_LIFECYCLES.map((s) => <SelectItem key={s} value={s}>{t(BOOKING_LIFECYCLE_KEYS[s])}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-label">{t('bookingReport.invoiceStatus')}</Label>
          <Select value={filters.invoice ?? ALL} onValueChange={(v) => setFilters({ invoice: v === ALL ? undefined : (v as ReportFilters['invoice']) })}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('bookingReport.allInvoice')}</SelectItem>
              {(['none', 'draft', 'invoiced'] as const).map((s) => (
                <SelectItem key={s} value={s}>{t(`bookingReport.invoice.${s}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {/* E-04 / C-04 som ét klik: det udvalg, der IKKE må overses. */}
        <Button
          size="sm"
          variant={preset ? 'default' : 'outline'}
          className="mb-0.5"
          onClick={() => setFilters(preset ? { status: undefined, invoice: undefined } : { status: 'completed', invoice: 'none' })}
        >
          {t('bookingReport.presetNotInvoiced')}
        </Button>
        {(filters.from || filters.to || filters.resource || filters.department || filters.status || filters.invoice) && (
          <Button size="sm" variant="ghost" className="mb-0.5 text-muted-foreground hover:text-foreground"
            onClick={() => void navigate({ search: {}, replace: true })}>
            {t('bookingHistory.clearFilters')}
          </Button>
        )}
      </div>

      {/* ── Nøgletal ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { k: 'kpiTotal', v: String(kpis.total) },
          { k: 'kpiCompletedNotInvoiced', v: String(kpis.completedNotInvoiced), warn: kpis.completedNotInvoiced > 0 },
          { k: 'kpiOnDraft', v: String(kpis.onDraft) },
          { k: 'kpiInvoiced', v: String(kpis.invoiced) },
          { k: 'kpiAmount', v: formatMoney(kpis.amount, currency, i18n.language) },
        ].map((x) => (
          <div key={x.k} className="rounded-md border px-4 py-3">
            <p className="text-xs text-muted-foreground">{t(`bookingReport.${x.k}`)}</p>
            <p className={cn('text-lg font-medium tabular-nums', x.warn && 'text-status-neutral-to-bad')}>{x.v}</p>
          </div>
        ))}
      </div>

      {(data?.length ?? 0) >= REPORT_MAX_ROWS && (
        <p className="text-xs text-status-neutral-to-bad">{t('bookingReport.capped', { count: REPORT_MAX_ROWS })}</p>
      )}

      {isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          entityLabel={t('bookingPage.entity')}
          searchText={(b) => `${b.resource?.name ?? ''} ${b.title ?? ''} ${b.employee?.full_name ?? ''} ${b.employee?.department?.name ?? ''} ${b.draft?.number ?? ''} ${b.draft?.invoice_no ?? ''}`}
          searchPlaceholder={t('bookingReport.searchPlaceholder')}
          storageKey="booking-report"
          toolbar={
            <div className="flex items-center gap-2">
              {canManage && (
                <Button size="sm" variant="outline" disabled={exportRows.length === 0} onClick={() => setInvoiceOpen(true)}>
                  <FileText className="size-4" /> {t('invoiceDrafts.generate')}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setExportOpen(true)}>
                <Download className="size-4" /> CSV
              </Button>
              <Button size="sm" variant="outline" disabled={pdfBusy} onClick={() => void exportPdf()}>
                <Printer className="size-4" /> PDF
              </Button>
            </div>
          }
          onRowClick={(b) => guarded(() => setActiveId(b.id === activeId ? null : b.id))}
          activeRowId={activeId}
          onVisibleRowsChange={setVisible}
        />
      )}

      {/* A-03: bookingen åbnes fra rapporten — samme panel som listen. */}
      {activeRow && (
        <BookingDetailPane
          key={activeRow.id}
          booking={activeRow as BookingHit}
          companyId={companyId}
          onClose={() => guarded(() => setActiveId(null))}
          onDirtyChange={setPaneDirty}
          onCancelled={() => setActiveId(null)}
          refresh={refresh}
        />
      )}

      {/* C-03: det viste (eller markerede) udvalg faktureres i én arbejdsgang. */}
      <InvoiceDraftGenerateDialog
        open={invoiceOpen}
        onOpenChange={setInvoiceOpen}
        companyId={companyId}
        bookingIds={exportRows.map((b) => b.id)}
        onDone={refresh}
      />

      <BookingExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        companyId={companyId}
        scope="report"
        scopeLabel={t(visible.selected.length > 0 ? 'bookingExport.scopeSelected' : 'bookingExport.scopeFiltered', { count: exportRows.length })}
        load={async () => exportRows}
      />

      <Dialog open={pendingAction !== null} onOpenChange={(open) => !open && setPendingAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('unsaved.title')}</DialogTitle>
            <DialogDescription>{t('unsaved.description')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingAction(null)}>{t('common.cancel')}</Button>
            <Button variant="destructive" onClick={() => { pendingAction?.(); setPendingAction(null) }}>
              {t('unsaved.discard')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
