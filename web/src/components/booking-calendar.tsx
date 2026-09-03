import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ChevronDown, ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { BookingDialog, useBookingResources } from '@/components/booking-dialog'
import { DateRangePicker, MiniCalendar } from '@/components/booking-mini-calendar'
import { useCompanyContext } from '@/hooks/use-company-context'
import {
  addDays,
  capFirst,
  dayFormat,
  diffDays,
  endOfDay,
  isoWeek,
  jaggedClip,
  longDayFormat,
  monthFormat,
  monthShortFormat,
  parseISODate,
  startOfDay,
  startOfWeek,
  stepAnchor,
  timeFormat,
  toISODate,
  viewRange,
  weekdayFormat,
  type CalendarView,
} from '@/lib/calendar'
import { holidayOn } from '@/lib/holidays'
import {
  bookingCategoryColorMap,
  bookingCategoryColors,
  bookingRpcErrorKey,
  bookingTimeLabel,
  fetchBookingsInRange,
  invalidateBookingQueries,
  type BookingHit,
} from '@/lib/booking'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { useQueryClient } from '@tanstack/react-query'

// Bookingkalenderen: hvornår er ressourcerne optaget, og hvor er der plads?
//  - Dag: dagens bookinger som liste.
//  - Uge/Måned/Periode: tidslinje med én række pr. ressource; overlappende
//    bookinger pakkes i baner under hinanden. Klik på en tom celle opretter
//    en booking på ressourcen/datoen; klik på en bjælke åbner bookingen.
//  - År: 12 månedskort med antal bookinger.
// Fremadrettede, hårde intervaller — ingen forfaldslogik (modsat aktivernes
// kalender, der kigger bagud på åbne perioder).

const MAX_TIMELINE_ROWS = 100

/** Bjælke-/prikfarve efter ressourcens kategori. */
export type BookingColorFn = (booking: BookingHit) => { background: string; color: string }

function useBookingsInRange(companyId: string | null, rangeStart: Date, rangeEnd: Date) {
  return useQuery({
    queryKey: ['booking-calendar', companyId, toISODate(rangeStart), toISODate(rangeEnd)],
    enabled: !!companyId,
    queryFn: () => fetchBookingsInRange(companyId!, rangeStart, rangeEnd),
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

/** Sidste døgn bookingen rører (ends_at er eksklusiv). */
function lastTouchedDay(b: BookingHit): Date {
  return startOfDay(new Date(new Date(b.ends_at).getTime() - 1))
}

function bookingBarText(b: BookingHit): string {
  const who = b.employee?.initials || b.employee?.full_name || ''
  const what = b.title || who
  const prefix = b.all_day ? '' : `${timeFormat.format(new Date(b.starts_at))} `
  return `${prefix}${what}${what !== who && who ? ` · ${who}` : ''}`
}

/** Sammenhængende kolonneintervaller med samme nøgle (måneds- og ugebånd). */
function segments(days: Date[], keyOf: (d: Date) => string) {
  const out: { start: number; end: number; date: Date }[] = []
  days.forEach((d, i) => {
    const key = keyOf(d)
    const last = out[out.length - 1]
    if (last && keyOf(last.date) === key) last.end = i
    else out.push({ start: i, end: i, date: d })
  })
  return out
}

/**
 * Baggrunden for en døgnkolonne: helligdag vejer tungest, så weekend, og
 * ellers ugens skiftevise bånd — så øjet kan følge en uge ned gennem
 * ressourcerne. I dag lægges ovenpå af kalderen.
 */
function dayTint(d: Date): string | undefined {
  const holiday = holidayOn(d)
  if (holiday?.official) return 'bg-status-bad/10'
  if (holiday || d.getDay() === 0 || d.getDay() === 6) return 'bg-muted/40'
  return isoWeek(d) % 2 === 0 ? 'bg-muted/15' : undefined
}

// Banepakning: overlappende bookinger på samme ressource lægges i hver sin
// bane (første ledige, sorteret efter start).
function packLanes(bookings: BookingHit[]): { booking: BookingHit; lane: number }[] {
  const sorted = [...bookings].sort(
    (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
  )
  const laneEnds: number[] = []
  return sorted.map((booking) => {
    const start = new Date(booking.starts_at).getTime()
    const end = new Date(booking.ends_at).getTime()
    let lane = laneEnds.findIndex((e) => e <= start)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(end)
    } else {
      laneEnds[lane] = end
    }
    return { booking, lane }
  })
}

// Listen bag dagsvisningen og dato-popup'en.
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
      {bookings.map((b) => (
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
          {b.all_day && (
            <span className="shrink-0 rounded-[4px] border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {t('bookingCalendar.allDay')}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

type ResourceRow = {
  id: string
  name: string
  location: string | null
  is_active: boolean
}

// Tidslinjen: én række pr. ressource, bookinger i baner. Tomme celler kan
// klikkes for at oprette en booking netop dér.
function Timeline({
  rangeStart,
  rangeEnd,
  resources,
  bookings,
  colorFor,
  today,
  onSelectBooking,
  onSelectDay,
  onCreate,
}: {
  rangeStart: Date
  rangeEnd: Date
  resources: ResourceRow[]
  bookings: BookingHit[]
  colorFor: BookingColorFn
  today: Date
  onSelectBooking: (b: BookingHit) => void
  onSelectDay: (day: Date) => void
  onCreate: (resourceId: string, day: Date) => void
}) {
  const { t } = useTranslation()
  const dayCount = diffDays(rangeStart, rangeEnd) + 1
  const days = useMemo(
    () => Array.from({ length: dayCount }, (_, i) => addDays(rangeStart, i)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toISODate(rangeStart), dayCount],
  )

  const rows = useMemo(() => {
    const byResource = new Map<string, BookingHit[]>()
    for (const b of bookings) {
      const list = byResource.get(b.resource_id) ?? []
      list.push(b)
      byResource.set(b.resource_id, list)
    }
    return resources.map((resource) => {
      const packed = packLanes(byResource.get(resource.id) ?? [])
      const lanes = Math.max(1, ...packed.map((p) => p.lane + 1))
      return { resource, packed, lanes }
    })
  }, [resources, bookings])

  const visibleRows = rows.slice(0, MAX_TIMELINE_ROWS)
  const gridCols = `minmax(160px, 200px) repeat(${dayCount}, minmax(24px, 1fr))`
  const todayISO = toISODate(today)
  const showWeekday = dayCount <= 14

  // Båndene over døgnene: måned øverst, uge i midten, dagen nærmest gitteret.
  const monthSegs = useMemo(
    () => segments(days, (d) => `${d.getFullYear()}-${d.getMonth()}`),
    [days],
  )
  const weekSegs = useMemo(() => segments(days, (d) => String(startOfWeek(d).getTime())), [days])

  if (rows.length === 0)
    return <p className="py-12 text-center text-[13px] text-muted-foreground">{t('bookingCalendar.noResources')}</p>

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-md border border-border bg-panel">
        <div style={{ minWidth: 160 + dayCount * 26 }}>
          {/* Månedsbånd — skiftevis tone, så månedsskiftet ses uden at læse */}
          <div className="grid border-b border-border/60" style={{ gridTemplateColumns: gridCols }}>
            <div className="sticky left-0 z-20 border-r border-border bg-panel" />
            {monthSegs.map((seg) => {
              const width = seg.end - seg.start + 1
              return (
                <div
                  key={seg.date.getTime()}
                  title={capFirst(monthFormat.format(seg.date))}
                  className={cn(
                    'truncate border-l border-border/60 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground',
                    seg.date.getMonth() % 2 === 0 ? 'bg-muted/50' : 'bg-muted/15',
                  )}
                  style={{ gridColumn: `${seg.start + 2} / ${seg.end + 3}` }}
                >
                  {width >= 5
                    ? capFirst(monthFormat.format(seg.date))
                    : width >= 2
                      ? capFirst(monthShortFormat.format(seg.date).replace('.', ''))
                      : ''}
                </div>
              )
            })}
          </div>

          {/* Ugebånd — skiftevis tone pr. ugenummer */}
          <div className="grid border-b border-border/60" style={{ gridTemplateColumns: gridCols }}>
            <div className="sticky left-0 z-20 border-r border-border bg-panel" />
            {weekSegs.map((seg) => {
              const week = isoWeek(seg.date)
              const width = seg.end - seg.start + 1
              return (
                <div
                  key={seg.date.getTime()}
                  title={t('bookingCalendar.week', { week })}
                  className={cn(
                    'truncate border-l border-border/60 px-1.5 py-0.5 text-[11px] text-muted-foreground',
                    week % 2 === 0 ? 'bg-muted/50' : 'bg-muted/15',
                  )}
                  style={{ gridColumn: `${seg.start + 2} / ${seg.end + 3}` }}
                >
                  {width >= 4 ? t('bookingCalendar.week', { week }) : width >= 2 ? week : ''}
                </div>
              )
            })}
          </div>

          {/* Datohoved — klik på en dag åbner dagens liste */}
          <div className="grid border-b border-border" style={{ gridTemplateColumns: gridCols }}>
            <div className="sticky left-0 z-20 border-r border-border bg-panel" />
            {days.map((d) => {
              const isToday = toISODate(d) === todayISO
              const holiday = holidayOn(d)
              return (
                <button
                  key={d.getTime()}
                  type="button"
                  onClick={() => onSelectDay(d)}
                  title={
                    holiday
                      ? `${longDayFormat.format(d)} — ${t(`bookingCalendar.holiday.${holiday.key}`)}`
                      : longDayFormat.format(d)
                  }
                  className={cn(
                    'flex flex-col items-center border-l border-border/60 px-0.5 py-1 text-[11px] tabular-nums transition-colors hover:bg-accent/50',
                    dayTint(d),
                    holiday?.official ? 'text-status-bad' : 'text-muted-foreground',
                    isToday && 'font-semibold text-foreground',
                  )}
                >
                  {showWeekday && <span>{weekdayFormat.format(d).replace('.', '')}</span>}
                  <span className={cn(isToday && 'rounded-[4px] bg-accent px-1')}>{d.getDate()}</span>
                </button>
              )
            })}
          </div>

          {visibleRows.map(({ resource, packed, lanes }) => (
            <div
              key={resource.id}
              className="grid border-b border-border/60 last:border-b-0"
              style={{ gridTemplateColumns: gridCols }}
            >
              <div
                className="sticky left-0 z-20 flex min-w-0 flex-col justify-center border-r border-border bg-panel px-2 py-1"
                style={{ gridRow: `1 / ${lanes + 1}` }}
              >
                <span className="truncate text-[12px] font-medium">{resource.name}</span>
                {resource.location && (
                  <span className="truncate text-[11px] text-muted-foreground">{resource.location}</span>
                )}
              </div>
              {/* Klikbare døgnceller (opret booking her) bag bjælkerne */}
              {days.map((d, i) => (
                <button
                  key={d.getTime()}
                  type="button"
                  aria-label={t('bookingCalendar.createHere', {
                    resource: resource.name,
                    date: dayFormat.format(d),
                  })}
                  onClick={() => onCreate(resource.id, d)}
                  className={cn(
                    'border-l border-border/40 transition-colors hover:bg-accent/50',
                    dayTint(d),
                    toISODate(d) === todayISO && 'bg-accent/40',
                  )}
                  style={{ gridColumn: i + 2, gridRow: `1 / ${lanes + 1}`, minHeight: lanes * 36 }}
                />
              ))}
              {packed.map(({ booking, lane }) => {
                const startDay = startOfDay(new Date(booking.starts_at))
                const endDay = lastTouchedDay(booking)
                const clampedStart = Math.max(0, diffDays(rangeStart, startDay))
                const clampedEnd = Math.min(dayCount - 1, diffDays(rangeStart, endDay))
                if (clampedEnd < clampedStart) return null
                const truncLeft = startDay < rangeStart
                const truncRight = endDay > endOfDay(rangeEnd)
                return (
                  <button
                    key={booking.id}
                    type="button"
                    onClick={() => onSelectBooking(booking)}
                    title={`${booking.resource?.name ?? ''} — ${bookingTimeLabel(booking)}`}
                    className={cn(
                      'z-10 my-1.5 flex h-6 min-w-0 items-center self-center overflow-hidden px-1.5 text-left text-[11px] font-medium',
                      !truncLeft && !truncRight && 'rounded-[4px]',
                    )}
                    style={{
                      gridColumn: `${clampedStart + 2} / ${clampedEnd + 3}`,
                      gridRow: lane + 1,
                      ...colorFor(booking),
                      clipPath: jaggedClip(truncLeft, truncRight),
                    }}
                  >
                    <span className="truncate">{bookingBarText(booking)}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      {rows.length > MAX_TIMELINE_ROWS && (
        <p className="text-xs text-status-neutral-to-bad">
          {t('bookingCalendar.rowsCapped', { count: MAX_TIMELINE_ROWS })}
        </p>
      )}
    </div>
  )
}

// Årsvisning: 12 månedskort med antal bookinger — klik åbner måneden.
function YearOverview({
  year,
  bookings,
  onPickMonth,
}: {
  year: number
  bookings: BookingHit[]
  onPickMonth: (monthStart: Date) => void
}) {
  const { t } = useTranslation()
  const months = Array.from({ length: 12 }, (_, m) => {
    const start = new Date(year, m, 1)
    const end = endOfDay(new Date(year, m + 1, 0))
    const count = bookings.filter(
      (b) => new Date(b.starts_at) <= end && new Date(b.ends_at) > start,
    ).length
    return { start, count }
  })
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {months.map((m) => (
        <button
          key={m.start.getMonth()}
          type="button"
          onClick={() => onPickMonth(m.start)}
          className="flex flex-col gap-1.5 rounded-md border border-border bg-panel p-3 text-left transition-colors hover:border-foreground/25 hover:bg-accent/40"
        >
          <span className="text-[13px] font-medium">{capFirst(monthFormat.format(m.start))}</span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {/* Tallet dækker alle kategorier, så prikken må ikke låne en
                kategorifarve — den er kun en markør. */}
            <span
              className="size-2 rounded-[2px]"
              style={{ backgroundColor: 'var(--booking-category-none)' }}
            />
            {t('bookingCalendar.bookingCount', { count: m.count })}
          </span>
        </button>
      ))}
    </div>
  )
}

// Bookingens detaljer + redigér/annullér.
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
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [busy, setBusy] = useState(false)

  const cancelBooking = async () => {
    if (!booking) return
    setBusy(true)
    const { error } = await supabase.rpc('cancel_booking', { p_booking_id: booking.id })
    setBusy(false)
    if (error) {
      const key = bookingRpcErrorKey(error)
      toast.error(key ? t(key) : describeError(error, t))
      return
    }
    toast.success(t('bookingFlow.cancelledToast'))
    setConfirmCancel(false)
    onChanged()
    onOpenChange(false)
  }

  return (
    <Dialog open={!!booking} onOpenChange={(open) => !open && onOpenChange(false)}>
      <DialogContent className="max-w-md">
        {booking && (
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
              {booking.status === 'cancelled' && (
                <p className="font-medium text-status-bad">{t('bookingPage.statusCancelled')}</p>
              )}
            </div>
            {booking.status === 'booked' && !confirmCancel && (
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => setConfirmCancel(true)}>
                  {t('bookingFlow.cancelBooking')}
                </Button>
                <Button size="sm" onClick={() => onEdit(booking)}>
                  {t('common.edit')}
                </Button>
              </DialogFooter>
            )}
            {booking.status === 'booked' && confirmCancel && (
              <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 p-3">
                <p className="text-[13px]">{t('bookingFlow.cancelConfirm')}</p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setConfirmCancel(false)}>
                    {t('common.no')}
                  </Button>
                  <Button variant="destructive" size="sm" disabled={busy} onClick={cancelBooking}>
                    {busy ? t('common.loading') : t('common.yes')}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </DialogContent>
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
}: {
  bookings: BookingHit[]
  categories: { id: string; name: string }[]
  byId: Map<string, number>
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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
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

export function BookingCalendar({
  view,
  dateISO,
  fromISO,
  toISO,
  onNavigate,
}: {
  view: CalendarView
  dateISO?: string
  fromISO?: string
  toISO?: string
  onNavigate: (next: { view?: CalendarView; date?: string; from?: string; to?: string }) => void
}) {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  const queryClient = useQueryClient()

  const today = startOfDay(new Date())
  const anchor = dateISO ? parseISODate(dateISO) : today
  const { start: rangeStart, end: rangeEnd } = viewRange(view, anchor, {
    from: fromISO ? parseISODate(fromISO) : undefined,
    to: toISO ? parseISODate(toISO) : undefined,
  })

  const { data, isPending } = useBookingsInRange(companyId, rangeStart, rangeEnd)
  const { data: resources } = useBookingResources(companyId)
  const { categories, byId: categoryColorById, colorFor } = useBookingCategoryColors(companyId)

  // Filtre er lokale (visning + dato er URL'en; filtrene er arbejdstilstand).
  const [term, setTerm] = useState('')
  const [onlyBooked, setOnlyBooked] = useState(false)

  const [selected, setSelected] = useState<BookingHit | null>(null)
  const [dayDialog, setDayDialog] = useState<Date | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createResourceId, setCreateResourceId] = useState<string | undefined>()
  const [createDateISO, setCreateDateISO] = useState<string | undefined>()
  const [editBooking, setEditBooking] = useState<BookingHit | null>(null)
  const [rangeOpen, setRangeOpen] = useState(false)

  const bookings = data?.bookings ?? []

  const filteredResources = useMemo(() => {
    const q = term.trim().toLowerCase()
    const withBookings = new Set(bookings.map((b) => b.resource_id))
    return (resources ?? [])
      .filter((r) => r.is_active || withBookings.has(r.id))
      .filter((r) => !onlyBooked || withBookings.has(r.id))
      .filter(
        (r) =>
          !q ||
          r.name.toLowerCase().includes(q) ||
          (r.location ?? '').toLowerCase().includes(q),
      )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resources, bookings, term, onlyBooked])

  const visibleBookings = useMemo(() => {
    const ids = new Set(filteredResources.map((r) => r.id))
    return bookings.filter((b) => ids.has(b.resource_id))
  }, [bookings, filteredResources])

  const dayBookingsFor = (day: Date) =>
    visibleBookings
      .filter(
        (b) => new Date(b.starts_at) <= endOfDay(day) && new Date(b.ends_at) > startOfDay(day),
      )
      .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())

  const go = onNavigate

  const step = (dir: 1 | -1) => {
    const span = diffDays(rangeStart, rangeEnd) + 1
    if (view === 'custom') {
      go({
        from: toISODate(addDays(rangeStart, span * dir)),
        to: toISODate(addDays(rangeEnd, span * dir)),
      })
    } else {
      go({ date: toISODate(stepAnchor(view, anchor, dir, span)) })
    }
  }

  const rangeLabel =
    view === 'day'
      ? capFirst(longDayFormat.format(anchor))
      : view === 'month'
        ? capFirst(monthFormat.format(anchor))
        : view === 'year'
          ? String(anchor.getFullYear())
          : `${dayFormat.format(rangeStart)} – ${dayFormat.format(rangeEnd)}`

  const openCreate = (resourceId?: string, day?: Date) => {
    setCreateResourceId(resourceId)
    setCreateDateISO(day ? toISODate(day) : undefined)
    setCreateOpen(true)
  }

  const refresh = () => invalidateBookingQueries(queryClient)

  return (
    <div className="flex w-full flex-col gap-4">
      {/* Filtre + ny booking */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-56">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={term}
            placeholder={t('bookingCalendar.searchPlaceholder')}
            className="h-8 pl-8"
            onChange={(e) => setTerm(e.target.value)}
          />
        </div>
        <Select value={onlyBooked ? 'booked' : 'all'} onValueChange={(v) => setOnlyBooked(v === 'booked')}>
          <SelectTrigger size="sm" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('bookingCalendar.allResources')}</SelectItem>
            <SelectItem value="booked">{t('bookingCalendar.onlyWithBookings')}</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" className="ml-auto" onClick={() => openCreate()}>
          <Plus className="size-4" /> {t('bookingFlow.newTitle')}
        </Button>
      </div>

      {data?.capped && (
        <p className="text-xs text-status-neutral-to-bad">{t('bookingCalendar.capped')}</p>
      )}

      {/* Forklaring over kalenderen — den skal kunne læses uden at scrolle
          forbi en lang tidslinje. Årsvisningen har ingen kategorifarver. */}
      {!isPending && view !== 'year' && (
        <CategoryLegend
          bookings={view === 'day' ? dayBookingsFor(anchor) : visibleBookings}
          categories={categories}
          byId={categoryColorById}
        />
      )}

      {/* Lille kalender til venstre; tidslinjen (og dens egen værktøjslinje)
          til højre. Årsvisningen er selv et årsoverblik og får ingen. */}
      <div className="flex flex-col items-start gap-4 xl:flex-row">
        {view !== 'year' && (
          <MiniCalendar
            className="w-full shrink-0 xl:w-[15rem]"
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            today={today}
            // Ét klik: behold visningen, flyt den til datoen (uge-visningen
            // hopper altså til dagens uge). Træk: sæt perioden.
            onPickDay={(d) =>
              go(
                view === 'custom'
                  ? { view: 'week', date: toISODate(d) }
                  : { view, date: toISODate(d) },
              )
            }
            onPickRange={(from, to) =>
              go({ view: 'custom', from: toISODate(from), to: toISODate(to) })
            }
          />
        )}

        <div className="flex w-full min-w-0 flex-1 flex-col gap-3">
          {/* Periode til venstre (åbner periodevælgeren), visning til højre */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                onClick={() => step(-1)}
                aria-label={t('bookingCalendar.prev')}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => go({ view: view === 'custom' ? 'week' : view, date: toISODate(today) })}
              >
                {t('bookingCalendar.today')}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                onClick={() => step(1)}
                aria-label={t('bookingCalendar.next')}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
            <Popover open={rangeOpen} onOpenChange={setRangeOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1.5 text-[13px] font-medium">
                  {rangeLabel}
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-4">
                <DateRangePicker
                  rangeStart={rangeStart}
                  rangeEnd={rangeEnd}
                  today={today}
                  onApply={(from, to) => {
                    setRangeOpen(false)
                    go({ view: 'custom', from: toISODate(from), to: toISODate(to) })
                  }}
                />
              </PopoverContent>
            </Popover>
            <Select
              value={view}
              onValueChange={(v) => go({ view: v as CalendarView, date: toISODate(anchor) })}
            >
              <SelectTrigger size="sm" className="ml-auto w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['day', 'week', 'month', 'year', 'custom'] as const).map((v) => (
                  <SelectItem key={v} value={v}>
                    {t(`bookingCalendar.view_${v}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : view === 'day' ? (
            <DayBookingList
              bookings={dayBookingsFor(anchor)}
              colorFor={colorFor}
              onSelect={setSelected}
            />
          ) : view === 'year' ? (
            <YearOverview
              year={anchor.getFullYear()}
              bookings={visibleBookings}
              onPickMonth={(m) => go({ view: 'month', date: toISODate(m) })}
            />
          ) : (
            <Timeline
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              resources={filteredResources}
              bookings={visibleBookings}
              colorFor={colorFor}
              today={today}
              onSelectBooking={setSelected}
              onSelectDay={setDayDialog}
              onCreate={(resourceId, day) => openCreate(resourceId, day)}
            />
          )}
        </div>
      </div>

      {/* Dagens liste (klik på en dato i tidslinjen) */}
      <Dialog open={!!dayDialog} onOpenChange={(open) => !open && setDayDialog(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          {dayDialog && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">{capFirst(longDayFormat.format(dayDialog))}</DialogTitle>
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
    </div>
  )
}
