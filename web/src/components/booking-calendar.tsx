import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  AlignLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Download,
  Plus,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { BookingDialog } from '@/components/booking-dialog'
import { useBookingResources } from '@/components/booking-form'
import { BookingDateFilter, BookingFilterBar } from '@/components/booking-filter-bar'
import { BookingMonthGrid } from '@/components/booking-month-grid'
import { BookingExportDialog } from '@/components/booking-export-dialog'
import { BookingTimeline, StatusLegend, type BookingColorFn } from '@/components/booking-timeline'
import { useAccess } from '@/hooks/use-access'
import { useCompanyContext } from '@/hooks/use-company-context'
import {
  capFirst,
  dayFormat,
  endOfDay,
  isoWeek,
  longDayFormat,
  monthFormat,
  parseISODate,
  startOfDay,
  toISODate,
} from '@/lib/calendar'
import {
  BOOKING_EMBED,
  BOOKING_LIFECYCLE_KEYS,
  CALENDAR_MAX_ROWS,
  bookingCategoryColorMap,
  bookingParticipantsLabel,
  bookingCategoryColors,
  bookingLifecycle,
  bookingLifecycleClass,
  bookingRpcErrorKey,
  bookingTimeLabel,
  fetchBookingsInRange,
  invalidateBookingQueries,
  type BookingHit,
  type BookingLifecycle,
} from '@/lib/booking'
import {
  bookingHorizon,
  bookingMatches,
  dayHourWindow,
  horizonBounds,
  stepBooking,
  DAY_WINDOW,
  RESOURCE_ALL,
  RESOURCE_WITH_BOOKINGS,
  type BookingCalendarSearch,
  type BookingPeriod,
  type BookingStatusFilter,
  type BookingView,
} from '@/lib/booking-view'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

// Bookingsiden: hvornår er ressourcerne optaget, og hvor er der plads?
//
//  - Tidslinjen (booking-timeline.tsx) er hovedvisningen: én række pr.
//    ressource, bookingerne som bjælker. Dag viser timekolonner, uge og måned
//    døgnkolonner.
//  - Kalenderen er indtil videre dagsopdelte lister for perioden; selve
//    kalendergitteret designes senere.
//
// Perioden, filtrene og fritekstsøgningen bor i URL'en, så en indsnævret
// tidslinje kan deles og overleve en genindlæsning.

/** Fritekst skrives i URL'en, men først når fingrene falder til ro. */
const QUERY_DEBOUNCE_MS = 300

function useBookingsInRange(
  companyId: string | null,
  rangeStart: Date,
  rangeEnd: Date,
  includeCancelled: boolean,
) {
  return useQuery({
    queryKey: [
      'booking-calendar',
      companyId,
      toISODate(rangeStart),
      toISODate(rangeEnd),
      includeCancelled,
    ],
    enabled: !!companyId,
    queryFn: () => fetchBookingsInRange(companyId!, rangeStart, rangeEnd, { includeCancelled }),
  })
}

/**
 * Kategoriernes farver. Sorteret på created_at, ikke navn — rækkefølgen bruges
 * kun som fallback for en tom color_index, og dér skal en omdøbning ikke kunne
 * bytte om på farverne.
 */
function useBookingCategoryColors(companyId: string | null) {
  const { data } = useQuery({
    queryKey: ['booking-category-colors', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('booking_categories')
        .select('id, name, color_index, created_at')
        .eq('company_id', companyId!)
        .order('created_at')
        .order('id')
      if (error) throw error
      return data ?? []
    },
  })

  return useMemo(() => {
    const rows = data ?? []
    const byId = bookingCategoryColorMap(rows)
    const colorFor: BookingColorFn = (booking) => {
      const categoryId = booking.resource?.category_id ?? null
      return bookingCategoryColors(categoryId ? (byId.get(categoryId) ?? null) : null)
    }
    return { categories: rows, byId, colorFor }
  }, [data])
}

// Listen bag kalendervisningen og dato-popup'en.
function DayBookingList({
  bookings,
  colorFor,
  onSelect,
}: {
  bookings: BookingHit[]
  colorFor: BookingColorFn
  onSelect: (b: BookingHit) => void
}) {
  const { t } = useTranslation()
  if (bookings.length === 0)
    return <p className="py-8 text-center text-[13px] text-muted-foreground">{t('bookingCalendar.empty')}</p>
  return (
    <div className="flex flex-col divide-y divide-border rounded-md border border-border bg-panel">
      {bookings.map((b) => {
        const stage = bookingLifecycle(b)
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => onSelect(b)}
            className="flex items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-accent/40"
          >
            <span
              className="size-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: colorFor(b).background }}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="truncate text-[13px] font-medium">{b.resource?.name ?? '—'}</span>
                {b.title && <span className="truncate text-xs text-muted-foreground">{b.title}</span>}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {bookingTimeLabel(b)}
                {b.employee?.full_name ? ` · ${b.employee.full_name}` : ''}
              </span>
            </span>
            <span className={cn('shrink-0 text-[11px]', bookingLifecycleClass(stage))}>
              {t(BOOKING_LIFECYCLE_KEYS[stage])}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// Bookingens detaljer + redigér/annullér.
/**
 * Faktureringsmarkeringen er en økonomihandling — manager/booking_manager,
 * spejler can_manage_bookings i databasen. En booking_handler, der lægger
 * bookinger ind, skal ikke kunne låse dem for redigering.
 */
export function useCanManageBookings(): boolean {
  const { data: access } = useAccess()
  if (!access) return false
  return access.isPlatformAdmin || access.isManager || access.roles.has('booking_manager')
}

/**
 * Bookingens detaljer og handlinger.
 *
 * Handlingerne følger statusmodellen (A-02): frem til fakturering kan
 * bookingen rettes og annulleres (A-03); efter fakturering er den låst, og
 * eneste vej tilbage er at fjerne markeringen igen — en rettelse af en
 * faktureret booking skal ellers gå gennem en kreditnota (C-09), som ikke
 * findes endnu. Alle tre RPC'er gentjekker det server-side; knapperne her er
 * kun UX.
 */
export function BookingDetailDialog({
  booking,
  onOpenChange,
  onEdit,
  onChanged,
}: {
  booking: BookingHit | null
  onOpenChange: (open: boolean) => void
  onEdit: (b: BookingHit) => void
  onChanged: () => void
}) {
  const { t } = useTranslation()
  const canManage = useCanManageBookings()
  const [confirm, setConfirm] = useState<'invoice' | 'clearInvoice' | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const stage = booking ? bookingLifecycle(booking) : null

  // Popup'en lukkes efter enhver handling: `booking` er et øjebliksbillede fra
  // listen/kalenderen, så en åben popup ville vise den gamle status videre,
  // selv om listen bagved er opdateret.
  const run = async (
    // PostgrestFilterBuilder er "thenable", ikke en rigtig Promise.
    call: () => PromiseLike<{ error: { message?: string } | null }>,
    successKey: string,
  ) => {
    setBusy(true)
    const { error } = await call()
    setBusy(false)
    if (error) {
      const key = bookingRpcErrorKey(error)
      toast.error(key ? t(key) : describeError(error, t))
      return
    }
    toast.success(t(successKey))
    setConfirm(null)
    onChanged()
    onOpenChange(false)
  }

  const confirmText =
    confirm === 'invoice'
      ? t('bookingFlow.markInvoicedConfirm')
      : t('bookingFlow.clearInvoicedConfirm')

  const runConfirmed = () => {
    if (!booking) return
    if (confirm === 'invoice')
      return run(
        () => supabase.rpc('set_booking_invoiced', { p_booking_id: booking.id, p_invoiced: true }),
        'bookingFlow.invoicedToast',
      )
    return run(
      () => supabase.rpc('set_booking_invoiced', { p_booking_id: booking.id, p_invoiced: false }),
      'bookingFlow.invoiceClearedToast',
    )
  }

  return (
    <Dialog
      open={!!booking}
      onOpenChange={(open) => {
        if (!open) {
          setConfirm(null)
          onOpenChange(false)
        }
      }}
    >
      <DialogContent className="max-w-md">
        {booking && stage && (
          <>
            <DialogHeader>
              <DialogTitle className="text-base">
                {booking.resource?.name ?? t('bookingFlow.resource')}
              </DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-2 text-[13px]">
              <p>{bookingTimeLabel(booking)}</p>
              {booking.title && <p className="text-muted-foreground">{booking.title}</p>}
              <p className="text-muted-foreground">
                {t('bookingFlow.employee')}: {booking.employee?.full_name ?? t('bookingFlow.unknownEmployee')}
              </p>
              {bookingParticipantsLabel(booking) && (
                <p className="text-muted-foreground">
                  {t('bookingFlow.participants')}: {bookingParticipantsLabel(booking)}
                </p>
              )}
              {booking.cancellation_reason && (
                <p className="text-muted-foreground">
                  {t('bookingFlow.cancelReason')}: {booking.cancellation_reason}
                </p>
              )}
              <p className={cn('font-medium', bookingLifecycleClass(stage))}>
                {t('bookingPage.status')}: {t(BOOKING_LIFECYCLE_KEYS[stage])}
              </p>
              {booking.invoiced_at && (
                <p className="text-muted-foreground">
                  {t('bookingFlow.invoicedAt')}: {dayFormat.format(new Date(booking.invoiced_at))}
                </p>
              )}
            </div>
            {!confirm && (
              <DialogFooter className="sm:justify-between">
                {/* Eksport (B-01) står til venstre for de handlinger, der
                    ÆNDRER bookingen — og gælder også en annulleret eller
                    faktureret booking, som netop er dem, man skal kunne
                    dokumentere bagefter. */}
                {canManage ? (
                  <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
                    <Download className="size-4" /> {t('bookingExport.export')}
                  </Button>
                ) : (
                  <span />
                )}
                <div className="flex gap-2">
                  {stage !== 'cancelled' &&
                    (stage === 'invoiced'
                      ? canManage && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setConfirm('clearInvoice')}
                          >
                            {t('bookingFlow.clearInvoiced')}
                          </Button>
                        )
                      : (
                          <>
                            {stage === 'completed' && canManage && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setConfirm('invoice')}
                              >
                                {t('bookingFlow.markInvoiced')}
                              </Button>
                            )}
                            {/* Annullering bor i redigeringsdialogen (A-07):
                                den kræver en årsag, og et felt hører hjemme
                                dér hvor bookingen i forvejen redigeres. */}
                            <Button size="sm" onClick={() => onEdit(booking)}>
                              {t('common.edit')}
                            </Button>
                          </>
                        ))}
                </div>
              </DialogFooter>
            )}
            {confirm && (
              <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
                <p className="text-[13px]">{confirmText}</p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setConfirm(null)}>
                    {t('common.no')}
                  </Button>
                  <Button size="sm" disabled={busy} onClick={() => void runConfirmed()}>
                    {busy ? t('common.loading') : t('common.yes')}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </DialogContent>

      {booking && (
        <BookingExportDialog
          open={exportOpen}
          onOpenChange={setExportOpen}
          companyId={booking.company_id}
          scope="booking"
          entityId={booking.id}
          scopeLabel={`${booking.resource?.name ?? ''} · ${bookingTimeLabel(booking)}`}
          load={async () => [booking]}
        />
      )}
    </Dialog>
  )
}

/**
 * Farveforklaring. Viser kun de kategorier der faktisk er bjælker for i den
 * valgte periode — en fast liste over alle kategorier ville fylde mest på de
 * tomme uger, hvor der er mindst at forklare.
 */
function CategoryLegend({
  bookings,
  categories,
  byId,
  className,
}: {
  bookings: BookingHit[]
  categories: { id: string; name: string }[]
  byId: Map<string, number>
  className?: string
}) {
  const { t } = useTranslation()

  // Bevidst uden useMemo: dagsvisningen sender en frisk liste hver render, så
  // en memo ville alligevel aldrig ramme — og et sæt over de synlige bookinger
  // er intet mod at tegne selve gitteret.
  const present = new Set(bookings.map((b) => b.resource?.category_id ?? ''))
  const items = categories
    .filter((c) => present.has(c.id))
    .map((c) => ({ key: c.id, name: c.name, ...bookingCategoryColors(byId.get(c.id) ?? null) }))
  if (present.has(''))
    items.push({ key: 'none', name: t('bookingCalendar.noCategory'), ...bookingCategoryColors(null) })

  if (items.length === 0) return null

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground',
        className,
      )}
    >
      {items.map((it) => (
        <span key={it.key} className="flex items-center gap-1.5">
          <span
            className="size-2.5 shrink-0 rounded-[2px]"
            style={{ backgroundColor: it.background }}
          />
          <span className="truncate">{it.name}</span>
        </span>
      ))}
    </div>
  )
}

/** Fanerne over kalenderen/tidslinjen. */
function ViewTabs({
  view,
  onChange,
}: {
  view: BookingView
  onChange: (v: BookingView) => void
}) {
  const { t } = useTranslation()
  const tabs: { key: BookingView; icon: typeof CalendarDays; label: string }[] = [
    { key: 'calendar', icon: CalendarDays, label: t('bookingCalendar.tabCalendar') },
    { key: 'timeline', icon: AlignLeft, label: t('bookingCalendar.tabTimeline') },
  ]
  return (
    <div className="flex items-center gap-1 border-b border-border">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          className={cn(
            '-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
            view === tab.key
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          <tab.icon className="size-4" />
          {tab.label}
        </button>
      ))}
    </div>
  )
}

export function BookingCalendar({
  search,
  onChange,
}: {
  search: BookingCalendarSearch
  onChange: (next: BookingCalendarSearch) => void
}) {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  const queryClient = useQueryClient()

  const today = startOfDay(new Date())
  const view: BookingView = search.view ?? 'timeline'
  const period: BookingPeriod = search.period ?? 'week'
  const resource = search.resource ?? RESOURCE_ALL
  const status: BookingStatusFilter = search.status ?? 'any'
  const anchor = search.date ? parseISODate(search.date) : today

  const horizon = useMemo(
    () =>
      bookingHorizon(period, anchor, {
        from: search.from ? parseISODate(search.from) : undefined,
        to: search.to ? parseISODate(search.to) : undefined,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [period, search.date, search.from, search.to, toISODate(today)],
  )

  // Fritekst tastes lokalt og lægges i URL'en, når fingrene falder til ro;
  // en URL, der skifter udefra (tilbageknappen), vinder over feltet.
  const [term, setTerm] = useState(search.q ?? '')
  const pushed = useRef(search.q ?? '')
  useEffect(() => {
    const id = setTimeout(() => {
      const next = term.trim()
      if (next === (search.q ?? '')) return
      pushed.current = next
      onChange({ q: next || undefined })
    }, QUERY_DEBOUNCE_MS)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, search.q])
  useEffect(() => {
    const urlQuery = search.q ?? ''
    if (urlQuery === pushed.current) return
    pushed.current = urlQuery
    setTerm(urlQuery)
  }, [search.q])

  // Annullerede bookinger hentes kun, når de er valgt: de optager ingen plads
  // i virkeligheden, og en bjælke for dem ville læses som "optaget".
  const { data, isPending } = useBookingsInRange(
    companyId,
    horizon.start,
    horizon.end,
    status === 'cancelled',
  )
  const { data: resources } = useBookingResources(companyId)
  const { categories, byId: categoryColorById, colorFor } = useBookingCategoryColors(companyId)

  const canManage = useCanManageBookings()
  const [selected, setSelected] = useState<BookingHit | null>(null)
  const [dayDialog, setDayDialog] = useState<Date | null>(null)
  const [rangeExport, setRangeExport] = useState(false)
  const [infoResource, setInfoResource] = useState<{ id: string; name: string; location: string | null } | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createResourceId, setCreateResourceId] = useState<string | undefined>()
  const [createDateISO, setCreateDateISO] = useState<string | undefined>()
  const [editBooking, setEditBooking] = useState<BookingHit | null>(null)

  const query = term.trim().toLowerCase()
  const allBookings = useMemo(() => data?.bookings ?? [], [data])

  const statusBookings = useMemo(
    () =>
      allBookings.filter((b) => {
        const stage = bookingLifecycle(b)
        return status === 'any' ? stage !== 'cancelled' : stage === status
      }),
    [allBookings, status],
  )

  /**
   * Rækkerne. Søgningen fjerner en ressource, der hverken selv matcher eller
   * har et træf — men lader rækkens øvrige bookinger stå (nedtonet i
   * tidslinjen), så belægningen stadig kan læses.
   */
  const visibleResources = useMemo(() => {
    const withBookings = new Set(statusBookings.map((b) => b.resource_id))
    let list = (resources ?? []).filter((r) => r.is_active || withBookings.has(r.id))
    if (resource === RESOURCE_WITH_BOOKINGS) list = list.filter((r) => withBookings.has(r.id))
    else if (resource !== RESOURCE_ALL) list = list.filter((r) => r.id === resource)
    if (query) {
      const hits = new Set(
        statusBookings.filter((b) => bookingMatches(b, query)).map((b) => b.resource_id),
      )
      list = list.filter(
        (r) =>
          hits.has(r.id) ||
          r.name.toLowerCase().includes(query) ||
          (r.location ?? '').toLowerCase().includes(query),
      )
    }
    return list
  }, [resources, statusBookings, resource, query])

  const visibleBookings = useMemo(() => {
    const ids = new Set(visibleResources.map((r) => r.id))
    return statusBookings.filter((b) => ids.has(b.resource_id))
  }, [statusBookings, visibleResources])

  /** Kalendervisningen viser kun træf — dér er der ingen række at tone ned. */
  const agendaBookings = useMemo(
    () => (query ? visibleBookings.filter((b) => bookingMatches(b, query)) : visibleBookings),
    [visibleBookings, query],
  )

  const hours = useMemo(
    () => (period === 'day' ? dayHourWindow(horizon.start, visibleBookings) : DAY_WINDOW),
    [period, horizon.start, visibleBookings],
  )
  const bounds = useMemo(
    () => horizonBounds(period, horizon, hours),
    [period, horizon, hours],
  )

  const presentStages = useMemo(() => {
    const seen = new Set(visibleBookings.map((b) => bookingLifecycle(b)))
    return (['booked', 'in_use', 'completed', 'invoiced', 'cancelled'] as BookingLifecycle[]).filter(
      (s) => seen.has(s),
    )
  }, [visibleBookings])

  const rangeLabel =
    period === 'day'
      ? capFirst(longDayFormat.format(horizon.start))
      : period === 'month'
        ? capFirst(monthFormat.format(horizon.start))
        : period === 'week'
          ? `${t('bookingCalendar.week', { week: isoWeek(horizon.start) })} · ${dayFormat.format(horizon.start)} – ${dayFormat.format(horizon.end)}`
          : `${dayFormat.format(horizon.start)} – ${dayFormat.format(horizon.end)}`

  const dayBookingsFor = (day: Date) =>
    agendaBookings
      .filter(
        (b) => new Date(b.starts_at) <= endOfDay(day) && new Date(b.ends_at) > startOfDay(day),
      )
      .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())

  const openCreate = (resourceId?: string, day?: Date) => {
    setCreateResourceId(resourceId)
    setCreateDateISO(day ? toISODate(day) : undefined)
    setCreateOpen(true)
  }

  const refresh = () => invalidateBookingQueries(queryClient)

  const navButtons: {
    key: string
    icon: typeof ChevronLeft
    label: string
    run: () => void
  }[] = [
    {
      key: 'prevPeriod',
      icon: ChevronsLeft,
      label: t('bookingCalendar.prevPeriod'),
      run: () => onChange(stepBooking(period, horizon, 'period', -1)),
    },
    {
      key: 'prevDay',
      icon: ChevronLeft,
      label: t('bookingCalendar.prevDay'),
      run: () => onChange(stepBooking(period, horizon, 'day', -1)),
    },
  ]
  const navButtonsAfter: typeof navButtons = [
    {
      key: 'nextDay',
      icon: ChevronRight,
      label: t('bookingCalendar.nextDay'),
      run: () => onChange(stepBooking(period, horizon, 'day', 1)),
    },
    {
      key: 'nextPeriod',
      icon: ChevronsRight,
      label: t('bookingCalendar.nextPeriod'),
      run: () => onChange(stepBooking(period, horizon, 'period', 1)),
    },
  ]

  return (
    <div className="flex w-full flex-col gap-4">
      <ViewTabs view={view} onChange={(v) => onChange({ view: v })} />

      <BookingFilterBar
        period={period}
        today={today}
        resource={resource}
        resources={resources ?? []}
        categories={categories}
        status={status}
        query={term}
        onChange={onChange}
        onQueryChange={setTerm}
        actions={
          <>
            {/* Eksport af HELE det viste tidsrum (B-01). Følger de samme
                filtre som tidslinjen — ressource, status og søgning — så
                udtrækket er det, brugeren kigger på. */}
            {canManage && (
              <Button size="sm" variant="outline" onClick={() => setRangeExport(true)}>
                <Download className="size-4" /> {t('bookingExport.export')}
              </Button>
            )}
            <Button size="sm" onClick={() => openCreate()}>
              <Plus className="size-4" /> {t('bookingFlow.newTitle')}
            </Button>
          </>
        }
      />

      {/* Periodevalg til venstre, frem/tilbage til højre */}
      <div className="flex flex-wrap items-center gap-2">
        <BookingDateFilter
          period={period}
          horizon={horizon}
          today={today}
          onChange={onChange}
        />
        <span className="text-[13px] font-medium">{rangeLabel}</span>
        <div className="ml-auto flex items-center gap-1">
          {navButtons.map((b) => (
            <Button
              key={b.key}
              size="icon"
              variant="ghost"
              className="size-8"
              title={b.label}
              aria-label={b.label}
              onClick={b.run}
            >
              <b.icon className="size-4" />
            </Button>
          ))}
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onChange({
                period: period === 'range' ? 'week' : period,
                date: toISODate(today),
              })
            }
          >
            {t('bookingCalendar.today')}
          </Button>
          {navButtonsAfter.map((b) => (
            <Button
              key={b.key}
              size="icon"
              variant="ghost"
              className="size-8"
              title={b.label}
              aria-label={b.label}
              onClick={b.run}
            >
              <b.icon className="size-4" />
            </Button>
          ))}
        </div>
      </div>

      {data?.capped && (
        <p className="text-xs text-status-neutral-to-bad">{t('bookingCalendar.capped')}</p>
      )}

      {isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : view === 'calendar' ? (
        <BookingMonthGrid
          horizon={horizon}
          bookings={agendaBookings}
          colorFor={colorFor}
          today={today}
          onSelectBooking={setSelected}
          onSelectDay={setDayDialog}
          onCreate={(day) => openCreate(undefined, day)}
        />
      ) : (
        <BookingTimeline
          period={period}
          horizon={horizon}
          hours={hours}
          bounds={bounds}
          resources={visibleResources}
          bookings={visibleBookings}
          query={query}
          colorFor={colorFor}
          today={today}
          resetKey={`${resource}|${status}|${query}`}
          onSelectBooking={setSelected}
          onSelectDay={setDayDialog}
          onCreate={(resourceId, day) => openCreate(resourceId, day)}
          onResourceInfo={canManage ? (r) => setInfoResource(r) : undefined}
        />
      )}

      {/* Forklaringerne står under gitteret, højrestillet: farven er
          kategoriens, formen er status'. De læses, når man er i tvivl om en
          bjælke — og skal ikke skubbe selve tidslinjen ned imens. */}
      {!isPending && (
        <div className="-mt-1 flex flex-col items-end gap-1.5">
          <CategoryLegend
            className="justify-end"
            bookings={visibleBookings}
            categories={categories}
            byId={categoryColorById}
          />
          <StatusLegend className="justify-end" stages={presentStages} />
        </div>
      )}

      {/* Dagens liste (klik på en dato i tidslinjen) */}
      <Dialog open={!!dayDialog} onOpenChange={(open) => !open && setDayDialog(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          {dayDialog && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">
                  {capFirst(longDayFormat.format(dayDialog))}
                </DialogTitle>
              </DialogHeader>
              <DayBookingList
                bookings={dayBookingsFor(dayDialog)}
                colorFor={colorFor}
                onSelect={(b) => {
                  setDayDialog(null)
                  setSelected(b)
                }}
              />
            </>
          )}
        </DialogContent>
      </Dialog>

      <BookingDetailDialog
        booking={selected}
        onOpenChange={(open) => !open && setSelected(null)}
        onEdit={(b) => {
          setSelected(null)
          setEditBooking(b)
        }}
        onChanged={refresh}
      />

      {/* Opret */}
      <BookingDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        companyId={companyId}
        initialResourceId={createResourceId}
        initialDateISO={createDateISO}
        onSaved={refresh}
      />

      {/* Redigér */}
      <BookingDialog
        open={!!editBooking}
        onOpenChange={(open) => !open && setEditBooking(null)}
        companyId={companyId}
        booking={editBooking}
        onSaved={refresh}
      />

      {/* Eksport af det viste tidsrum. Rækkerne er dem tidslinjen viser, så
          "følger de anvendte filtre" betyder det samme på skærmen og i filen. */}
      <BookingExportDialog
        open={rangeExport}
        onOpenChange={setRangeExport}
        companyId={companyId}
        scope="timeframe"
        scopeLabel={t('bookingExport.scopeTimeframe', {
          range: rangeLabel,
          count: visibleBookings.length,
        })}
        load={async () => visibleBookings}
      />

      <BookingResourceInfoDialog
        resource={infoResource}
        companyId={companyId}
        onOpenChange={(open) => !open && setInfoResource(null)}
      />
    </div>
  )
}

/**
 * Nøgletal for en ressource, åbnet fra info-ikonet i tidslinjen — og
 * indgangen til at eksportere ALLE bookinger på den, uanset hvilket tidsrum
 * kalenderen står på.
 *
 * Bevidst kun læsning: ressourcens stamdata (navn, kategori, kapacitet,
 * tidsgranularitet) rettes på Booking → Ressourcer, og to steder at rette det
 * samme er én for mange. Derfor et info-ikon og ikke en blyant.
 */
function BookingResourceInfoDialog({
  resource,
  companyId,
  onOpenChange,
}: {
  resource: { id: string; name: string; location: string | null } | null
  companyId: string | null
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [exportOpen, setExportOpen] = useState(false)

  const { data: stats } = useQuery({
    queryKey: ['booking-resource-stats', resource?.id],
    enabled: !!resource,
    queryFn: async () => {
      const nowISO = new Date().toISOString()
      // Tre tællinger frem for at hente rækkerne: head + count er ét opslag
      // uden data, og tallene er alt, dialogen viser.
      const base = () =>
        supabase
          .from('bookings')
          .select('id', { count: 'exact', head: true })
          .eq('resource_id', resource!.id)
      const [total, upcoming, cancelled] = await Promise.all([
        base(),
        base().eq('status', 'booked').gte('ends_at', nowISO),
        base().eq('status', 'cancelled'),
      ])
      if (total.error) throw total.error
      return {
        total: total.count ?? 0,
        upcoming: upcoming.count ?? 0,
        cancelled: cancelled.count ?? 0,
      }
    },
  })

  const loadAll = async (): Promise<BookingHit[]> => {
    const { data, error } = await supabase
      .from('bookings')
      .select(BOOKING_EMBED)
      .eq('resource_id', resource!.id)
      .order('starts_at')
      .limit(CALENDAR_MAX_ROWS)
    if (error) throw error
    return (data ?? []) as unknown as BookingHit[]
  }

  return (
    <Dialog open={!!resource} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {resource && (
          <>
            <DialogHeader>
              <DialogTitle className="text-base">{resource.name}</DialogTitle>
              {resource.location && <DialogDescription>{resource.location}</DialogDescription>}
            </DialogHeader>

            <div className="flex flex-col gap-2 text-[13px]">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('bookingCalendar.statTotal')}</span>
                <span className="tabular-nums">{stats?.total ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('bookingCalendar.statUpcoming')}</span>
                <span className="tabular-nums">{stats?.upcoming ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('bookingCalendar.statCancelled')}</span>
                <span className="tabular-nums">{stats?.cancelled ?? '—'}</span>
              </div>
            </div>

            <DialogFooter className="sm:justify-between">
              <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
                <Download className="size-4" /> {t('bookingExport.export')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
                {t('common.close')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>

      {resource && (
        <BookingExportDialog
          open={exportOpen}
          onOpenChange={setExportOpen}
          companyId={companyId}
          scope="resource"
          entityId={resource.id}
          scopeLabel={t('bookingExport.scopeResource', { name: resource.name })}
          load={loadAll}
        />
      )}
    </Dialog>
  )
}
