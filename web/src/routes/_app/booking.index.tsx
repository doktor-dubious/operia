import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Download, FileText, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { InvoiceDraftGenerateDialog } from '@/components/invoice-draft-generate-dialog'
import { BookingDetailPane } from '@/components/booking-detail-pane'
import { BookingExportDialog } from '@/components/booking-export-dialog'
import { useCanManageBookings, useCanOperateBookings } from '@/components/booking-calendar'
import { BookingDialog } from '@/components/booking-dialog'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { useCompanyContext } from '@/hooks/use-company-context'
import {
  BOOKING_EMBED,
  BOOKING_LIFECYCLE_KEYS,
  BOOKING_LIFECYCLES,
  bookingLifecycle,
  bookingLifecycleClass,
  bookingTimeLabel,
  invalidateBookingQueries,
  type BookingHit,
} from '@/lib/booking'
import { supabase } from '@/lib/supabase'

// Bookinglisten: kommende som standard, med afholdte og annullerede bag et
// filter. Et klik på en række åbner detaljepanelet under tabellen (samme
// master/detail-mønster som ressourcer og kategorier) med faner til
// stamdata, tidsrum, formål, tilkøbsydelser og handlinger. Selve
// kalenderoverblikket — og dets popup — bor på /booking/calendar.

export const Route = createFileRoute('/_app/booking/')({
  component: BookingListPage,
})

type Scope = 'upcoming' | 'past' | 'cancelled' | 'all'

function useBookings(companyId: string | null, scope: Scope) {
  return useQuery({
    queryKey: ['booking-list', companyId, scope],
    enabled: !!companyId,
    queryFn: async () => {
      let q = supabase
        .from('bookings')
        .select(BOOKING_EMBED)
        .eq('company_id', companyId!)
        .limit(500)
      const nowISO = new Date().toISOString()
      if (scope === 'upcoming')
        q = q.eq('status', 'booked').gte('ends_at', nowISO).order('starts_at')
      else if (scope === 'past')
        q = q.eq('status', 'booked').lt('ends_at', nowISO).order('starts_at', { ascending: false })
      else if (scope === 'cancelled')
        q = q.eq('status', 'cancelled').order('starts_at', { ascending: false })
      else q = q.order('starts_at', { ascending: false })
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as BookingHit[]
    },
  })
}

function BookingListPage() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  const queryClient = useQueryClient()
  const [scope, setScope] = useState<Scope>('upcoming')
  const { data, isPending } = useBookings(companyId, scope)

  const [activeId, setActiveId] = useState<string | null>(null)
  const [paneDirty, setPaneDirty] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  // Rækkerne DataTable faktisk viser efter søgning, kolonnefiltre og
  // markering — det er dem, eksporten skal følge (B-01: "følger de anvendte
  // filtre"). Tabellen melder dem tilbage, så filen og skærmen er enige.
  const [exportRows, setExportRows] = useState<{ filtered: BookingHit[]; selected: BookingHit[] }>({
    filtered: [],
    selected: [],
  })
  const canManage = useCanManageBookings()
  const canOperate = useCanOperateBookings()
  const [invoiceOpen, setInvoiceOpen] = useState(false)

  const refresh = () => invalidateBookingQueries(queryClient)

  // Ugemte ændringer i panelet må ikke forsvinde, fordi man klikker på en
  // anden række — samme vagt som på ressource- og kategorisiden.
  const guarded = (action: () => void) => {
    if (paneDirty) setPendingAction(() => action)
    else action()
  }

  if (isPending || !companyId) return <Skeleton className="h-40 w-full" />

  const columns: ColumnDef<BookingHit>[] = [
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
      key: 'title',
      header: t('bookingFlow.title'),
      sortable: true,
      sortValue: (b) => b.title ?? '',
      render: (b) => b.title ?? '',
    },
    {
      // Statusmodellen (A-02). Trinnet udledes af tiden og invoiced_at, så
      // sortering og filtrering sker på det viste trin — ikke på den rå
      // status-kolonne, der kun kender aktiv/annulleret.
      key: 'status',
      header: t('bookingPage.status'),
      sortable: true,
      sortValue: (b) => BOOKING_LIFECYCLES.indexOf(bookingLifecycle(b)),
      filter: {
        options: BOOKING_LIFECYCLES.map((s) => ({ value: s, label: t(BOOKING_LIFECYCLE_KEYS[s]) })),
        valueOf: (b) => bookingLifecycle(b),
      },
      render: (b) => {
        const stage = bookingLifecycle(b)
        return <span className={bookingLifecycleClass(stage)}>{t(BOOKING_LIFECYCLE_KEYS[stage])}</span>
      },
    },
  ]

  const activeRow = data?.find((b) => b.id === activeId) ?? null

  return (
    <div className="flex min-h-full flex-col gap-6">
      <DataTable
        rows={data ?? []}
        columns={columns}
        entityLabel={t('bookingPage.entity')}
        searchText={(b) =>
          [b.resource?.name, b.employee?.full_name, b.title].filter(Boolean).join(' ')
        }
        storageKey="booking-list"
        toolbar={
          <div className="flex items-center gap-2">
            <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
              <SelectTrigger size="sm" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="upcoming">{t('bookingPage.scopeUpcoming')}</SelectItem>
                <SelectItem value="past">{t('bookingPage.scopePast')}</SelectItem>
                <SelectItem value="cancelled">{t('bookingPage.scopeCancelled')}</SelectItem>
                <SelectItem value="all">{t('bookingPage.scopeAll')}</SelectItem>
              </SelectContent>
            </Select>
            {canManage && (
              <Button size="sm" variant="outline" onClick={() => setExportOpen(true)}>
                <Download className="size-4" /> {t('bookingExport.export')}
              </Button>
            )}
            {/* Kladden dannes for det, listen VISER — markerede rækker hvis der er
                nogen, ellers hele det filtrerede udvalg. Det er C-03's "en periode
                i én arbejdsgang": filtret er arbejdsgangen. */}
            {canManage && (
              <Button size="sm" variant="outline" onClick={() => setInvoiceOpen(true)}>
                <FileText className="size-4" /> {t('invoiceDrafts.generate')}
              </Button>
            )}
            {canOperate && (
              <Button size="sm" variant="outline" onClick={() => setNewOpen(true)}>
                <Plus className="size-4" /> {t('common.new')}
              </Button>
            )}
          </div>
        }
        onRowClick={(b) => guarded(() => setActiveId(b.id === activeId ? null : b.id))}
        activeRowId={activeId}
        onVisibleRowsChange={setExportRows}
      />

      {activeRow && (
        <BookingDetailPane
          key={activeRow.id}
          booking={activeRow}
          companyId={companyId}
          onClose={() => guarded(() => setActiveId(null))}
          onDirtyChange={setPaneDirty}
          onCancelled={() => setActiveId(null)}
          refresh={refresh}
        />
      )}

      <BookingDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        companyId={companyId}
        onSaved={refresh}
      />

      {/* Har brugeren krydset rækker af, er DE udtrækket; ellers alt hvad
          søgning og kolonnefiltre har ladet stå. */}
      <InvoiceDraftGenerateDialog
        open={invoiceOpen}
        onOpenChange={setInvoiceOpen}
        companyId={companyId!}
        bookingIds={(exportRows.selected.length > 0 ? exportRows.selected : exportRows.filtered).map(
          (b) => b.id,
        )}
      />
      <BookingExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        companyId={companyId}
        scope={exportRows.selected.length > 0 ? 'selected' : 'filtered'}
        scopeLabel={t(
          exportRows.selected.length > 0
            ? 'bookingExport.scopeSelected'
            : 'bookingExport.scopeFiltered',
          {
            count:
              exportRows.selected.length > 0
                ? exportRows.selected.length
                : exportRows.filtered.length,
          },
        )}
        load={async () =>
          exportRows.selected.length > 0 ? exportRows.selected : exportRows.filtered
        }
      />

      <Dialog open={pendingAction !== null} onOpenChange={(open) => !open && setPendingAction(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('unsaved.title')}</DialogTitle>
            <DialogDescription>{t('unsaved.description')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingAction(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                pendingAction?.()
                setPendingAction(null)
              }}
            >
              {t('unsaved.discard')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
