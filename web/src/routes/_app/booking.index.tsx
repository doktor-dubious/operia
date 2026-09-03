import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { BookingDetailDialog } from '@/components/booking-calendar'
import { BookingDialog } from '@/components/booking-dialog'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { useCompanyContext } from '@/hooks/use-company-context'
import {
  BOOKING_EMBED,
  bookingTimeLabel,
  invalidateBookingQueries,
  type BookingHit,
} from '@/lib/booking'
import { supabase } from '@/lib/supabase'

// Bookinglisten: kommende som standard, med afholdte og annullerede bag et
// filter. Rækker åbner detaljepopup'en (redigér/annullér) — selve
// kalenderoverblikket bor på /booking/calendar.

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

  const [selected, setSelected] = useState<BookingHit | null>(null)
  const [editBooking, setEditBooking] = useState<BookingHit | null>(null)
  const [newOpen, setNewOpen] = useState(false)

  const refresh = () => invalidateBookingQueries(queryClient)

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
      key: 'status',
      header: t('bookingPage.status'),
      sortable: true,
      sortValue: (b) => b.status,
      render: (b) =>
        b.status === 'cancelled' ? (
          <span className="text-status-bad">{t('bookingPage.statusCancelled')}</span>
        ) : (
          t('bookingPage.statusBooked')
        ),
    },
  ]

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
            <Button size="sm" variant="outline" onClick={() => setNewOpen(true)}>
              <Plus className="size-4" /> {t('common.new')}
            </Button>
          </div>
        }
        onRowClick={(b) => setSelected(b.id === selected?.id ? null : b)}
        activeRowId={selected?.id ?? null}
      />

      <BookingDetailDialog
        booking={selected}
        onOpenChange={(open) => !open && setSelected(null)}
        onEdit={(b) => {
          setSelected(null)
          setEditBooking(b)
        }}
        onChanged={refresh}
      />
      <BookingDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        companyId={companyId}
        onSaved={refresh}
      />
      <BookingDialog
        open={!!editBooking}
        onOpenChange={(open) => !open && setEditBooking(null)}
        companyId={companyId}
        booking={editBooking}
        onSaved={refresh}
      />
    </div>
  )
}
