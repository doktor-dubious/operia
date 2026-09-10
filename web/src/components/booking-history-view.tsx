import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowRight } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { formatMoney, useCompanyCurrency } from '@/lib/booking-services'
import {
  HISTORY_SELECT,
  actorLabel,
  amountDelta,
  bookingLabel,
  describeChanges,
  emptyLookups,
  historySearchText,
  type HistoryRow,
  type Lookups,
} from '@/lib/booking-history'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

// Selve historiktabellen (EVU-krav D-05), delt af siden Booking → Historik og
// historik-fanen på en enkelt booking.
//
// Filtreringen sker to steder med vilje: PERIODE, BOOKING og BRUGER — de tre
// kravet nævner — afgrænser forespørgslen i basen, fordi historikken vokser og
// ikke skal hentes hjem for at blive smidt væk igen. Fritekstsøgning, sortering
// og sidevisning er DataTables egne og arbejder på det hentede udsnit.

const MAX_ROWS = 500

/** Stamdata til at oversætte hændelsernes id'er til navne. */
export function useHistoryLookups(companyId: string | null) {
  return useQuery({
    queryKey: ['booking-history-lookups', companyId],
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Lookups> => {
      const [res, emp, lev, svc, usr] = await Promise.all([
        supabase.from('booking_resources').select('id, name').eq('company_id', companyId!),
        supabase.from('employees').select('id, full_name').eq('company_id', companyId!),
        supabase.from('booking_participant_levels').select('id, name').eq('company_id', companyId!),
        supabase.from('booking_services').select('id, name').eq('company_id', companyId!),
        // Ikke app_users: DCA's platform-admins har ingen række dér, og hver
        // linje de havde rørt stod som "Ukendt bruger". RPC'en dækker begge
        // slags aktører — se migration 20260911090000.
        supabase.rpc('audit_actor_names', { p_company_id: companyId! }),
      ])
      const lk = emptyLookups()
      for (const r of res.data ?? []) lk.resources.set(r.id, r.name)
      for (const e of emp.data ?? []) lk.employees.set(e.id, e.full_name ?? '')
      for (const l of lev.data ?? []) lk.levels.set(l.id, l.name)
      for (const s of svc.data ?? []) lk.services.set(s.id, s.name)
      for (const u of usr.data ?? [])
        lk.users.set(u.user_id, { name: u.display_name, platform: u.platform })
      return lk
    },
  })
}

export type HistoryFilter = {
  companyId: string | null
  /** Sat = kun denne bookings historik (fanen på en booking). */
  bookingId?: string
  from?: string
  to?: string
  actorUserId?: string
  eventTypes?: readonly string[]
}

export function useBookingHistory(filter: HistoryFilter) {
  const { companyId, bookingId, from, to, actorUserId, eventTypes } = filter
  return useQuery({
    queryKey: ['booking-history', companyId, bookingId, from, to, actorUserId, eventTypes],
    enabled: !!companyId,
    queryFn: async () => {
      let q = supabase
        .from('booking_events')
        .select(HISTORY_SELECT)
        .eq('company_id', companyId!)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(MAX_ROWS)
      if (bookingId) q = q.eq('booking_id', bookingId)
      // Datoerne er hele dage i brugerens øjne; til-datoen skal derfor rumme
      // hele dagen, ikke stoppe ved midnat.
      if (from) q = q.gte('created_at', new Date(`${from}T00:00:00`).toISOString())
      if (to) q = q.lte('created_at', new Date(`${to}T23:59:59.999`).toISOString())
      if (actorUserId) q = q.eq('actor_user_id', actorUserId)
      if (eventTypes && eventTypes.length > 0) q = q.in('event_type', eventTypes)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as HistoryRow[]
    },
  })
}

export function BookingHistoryTable({
  rows,
  lookups,
  companyId,
  /** Fanen på én booking skjuler bookingkolonnen — den er den samme hele vejen ned. */
  showBooking = true,
  storageKey,
  toolbar,
  onVisibleRowsChange,
}: {
  rows: HistoryRow[]
  lookups: Lookups
  companyId: string | null
  showBooking?: boolean
  storageKey: string
  toolbar?: React.ReactNode
  onVisibleRowsChange?: (r: { filtered: HistoryRow[]; selected: HistoryRow[] }) => void
}) {
  const { t, i18n } = useTranslation()
  const currency = useCompanyCurrency(companyId)

  const columns = useMemo(() => {
    const cols: ColumnDef<HistoryRow>[] = [
      {
        key: 'created_at',
        header: t('bookingHistory.when'),
        sortable: true,
        sortValue: (r) => r.created_at,
        render: (r) => (
          <span className="whitespace-nowrap tabular-nums">
            {new Intl.DateTimeFormat(i18n.language.startsWith('en') ? 'en-GB' : 'da-DK', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              hourCycle: 'h23',
              timeZone: 'Europe/Copenhagen',
            }).format(new Date(r.created_at))}
          </span>
        ),
      },
    ]

    if (showBooking) {
      cols.push({
        key: 'booking',
        header: t('bookingHistory.booking'),
        sortable: true,
        sortValue: (r) => bookingLabel(r),
        render: (r) => <span className="block max-w-56 truncate">{bookingLabel(r)}</span>,
      })
    }

    cols.push(
      {
        key: 'event_type',
        header: t('bookingHistory.action'),
        sortable: true,
        sortValue: (r) => r.event_type,
        render: (r) => t(`bookingHistory.event.${r.event_type}`, r.event_type),
        filter: {
          options: [...new Set(rows.map((r) => r.event_type))].sort().map((v) => ({
            value: v,
            label: t(`bookingHistory.event.${v}`, v),
          })),
          valueOf: (r) => r.event_type,
        },
      },
      {
        // Den læsbare før/efter (D-04). Id'er er slået op mod stamdata, og
        // fritekst står som "ændret" uden værdier — bevidst, se lib'en.
        key: 'changes',
        header: t('bookingHistory.changes'),
        render: (r) => {
          const changes = describeChanges(r, lookups, t, i18n.language)
          if (changes.length === 0)
            return <span className="text-muted-foreground">{t('bookingHistory.noFields')}</span>
          return (
            <div className="flex flex-col gap-0.5">
              {changes.map((c, i) => (
                <div key={i} className="flex flex-wrap items-baseline gap-1.5 text-xs">
                  <span className="text-muted-foreground">{c.field}</span>
                  {c.from ? (
                    <>
                      <span className="line-through opacity-60">{c.from}</span>
                      <ArrowRight className="size-3 shrink-0 opacity-60" aria-hidden="true" />
                    </>
                  ) : null}
                  <span>{c.to}</span>
                </div>
              ))}
            </div>
          )
        },
      },
      {
        key: 'amount',
        header: t('bookingHistory.amount'),
        sortable: true,
        sortValue: (r) => amountDelta(r) ?? 0,
        render: (r) => {
          const delta = amountDelta(r)
          // null = kan ikke gøres op endnu (ingen priser uden for ydelserne).
          if (delta === null) return <span className="text-muted-foreground">—</span>
          return (
            <span
              className={cn(
                'whitespace-nowrap tabular-nums',
                delta > 0 && 'text-status-neutral-to-bad',
                delta < 0 && 'text-status-good',
              )}
            >
              {delta > 0 ? '+' : ''}
              {formatMoney(delta, currency, i18n.language)}
            </span>
          )
        },
      },
      {
        key: 'actor',
        header: t('bookingHistory.actor'),
        sortable: true,
        sortValue: (r) => actorLabel(r.actor_user_id, lookups, t),
        render: (r) => {
          // Et navn står som tekst; alt andet — platformen, den ukendte, og
          // ændringen der kom uden om brugerfladen — er en oplysning om
          // sporet selv og står dæmpet (D-02).
          const named = !!(r.actor_user_id && lookups.users.get(r.actor_user_id)?.name)
          const label = actorLabel(r.actor_user_id, lookups, t)
          return named ? label : <span className="text-muted-foreground">{label}</span>
        },
      },
    )
    return cols
  }, [t, i18n.language, lookups, rows, showBooking, currency])

  return (
    <DataTable
      rows={rows}
      columns={columns}
      entityLabel={t('bookingHistory.entity')}
      searchText={(r) => historySearchText(r, lookups)}
      searchPlaceholder={t('bookingHistory.searchPlaceholder')}
      storageKey={storageKey}
      toolbar={toolbar}
      onVisibleRowsChange={onVisibleRowsChange}
    />
  )
}

/** Historik-fanen på en enkelt booking. */
export function BookingHistoryTab({
  bookingId,
  companyId,
}: {
  bookingId: string
  companyId: string | null
}) {
  const { data: lookups } = useHistoryLookups(companyId)
  const { data, isPending } = useBookingHistory({ companyId, bookingId })
  if (isPending) return <Skeleton className="h-32 w-full" />
  return (
    <BookingHistoryTable
      rows={data ?? []}
      lookups={lookups ?? emptyLookups()}
      companyId={companyId}
      showBooking={false}
      storageKey={`booking-history-one`}
    />
  )
}
