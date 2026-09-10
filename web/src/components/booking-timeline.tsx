import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Info, ReceiptText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { BookingHoverDetails } from '@/components/booking-hover-details'
import { bookingBarLook } from '@/lib/booking-look'
import {
  bookingLifecycle,
  BOOKING_LIFECYCLE_KEYS,
  type BookingHit,
  type BookingLifecycle,
} from '@/lib/booking'
import {
  barGeometry,
  bookingMatches,
  timelineColumns,
  type BookingPeriod,
  type Horizon,
  type TimelineColumn,
} from '@/lib/booking-view'
import {
  capFirst,
  dayFormat,
  isoWeek,
  jaggedClip,
  longDayFormat,
  monthFormat,
  monthShortFormat,
  startOfWeek,
  toISODate,
  weekdayFormat,
  weekdayNarrowFormat,
} from '@/lib/calendar'
import { holidayOn } from '@/lib/holidays'
import { cn } from '@/lib/utils'

// Tidslinjen: én række pr. ressource, bookingerne som bjælker.
//
// Bjælkerne ligger i et lag OVEN PÅ døgngitteret og placeres i tid (procent af
// horisonten) frem for i kolonner. Det er dét, der gør dagsvisningens
// timekolonner mulige: 08:30–12:15 rammer mellem stregerne, mens uge og måned
// ser ud som hele døgn, fordi bookingerne dér i praksis er heldags.
//
// Farve = ressourcens kategori (som før). Status er lagt oveni som
// behandling — fyldt, grøn kant, falmet, skraveret — så et blik giver begge
// dele uden at kategorifarverne mister deres betydning.

/** Ti rækker pr. side og højst ti sideknapper — samme takt som tabellerne. */
const PAGE_SIZE = 10
const MAX_PAGE_BUTTONS = 10

const LABEL_WIDTH = 190
const MIN_COL_WIDTH = 26
const LANE_HEIGHT = 30
const BAR_HEIGHT = 24
/** Under disse bjælkebredder er der ikke plads til badge/tekst. */
const BADGE_MIN_PX = 74
const TEXT_MIN_PX = 30

export type BookingColorFn = (booking: BookingHit) => { background: string; color: string }

export type TimelineResource = {
  id: string
  name: string
  location: string | null
}

/** Bredden af selve gitteret — bjælkerne kender kun procenter, badgen kræver px. */
function useElementWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    setWidth(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [ref])
  return width
}

/** Sammenhængende kolonneintervaller med samme nøgle (måneds- og ugebånd). */
function segments(columns: TimelineColumn[], keyOf: (c: TimelineColumn) => string) {
  const out: { start: number; end: number; col: TimelineColumn }[] = []
  columns.forEach((col, i) => {
    const last = out[out.length - 1]
    if (last && keyOf(last.col) === keyOf(col)) last.end = i
    else out.push({ start: i, end: i, col })
  })
  return out
}

/**
 * Baggrunden for en kolonne: helligdag vejer tungest, så weekend, og ellers
 * ugens skiftevise bånd — så øjet kan følge en uge ned gennem ressourcerne.
 */
function columnTint(col: TimelineColumn): string | undefined {
  const holiday = holidayOn(col.date)
  if (holiday?.official) return 'bg-status-bad/10'
  if (holiday || col.weekend) return 'bg-muted/40'
  if (col.hour != null) return col.hour % 2 === 0 ? 'bg-muted/15' : undefined
  return isoWeek(col.date) % 2 === 0 ? 'bg-muted/15' : undefined
}

/** Weekend og officielle helligdage skrives røde — både ugedag og dato. */
function columnRed(col: TimelineColumn): boolean {
  return col.weekend || !!holidayOn(col.date)?.official
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

function BookingBar({
  booking,
  colorFor,
  gridWidth,
  bounds,
  lane,
  dimmed,
  onSelect,
}: {
  booking: BookingHit
  colorFor: BookingColorFn
  gridWidth: number
  bounds: { from: number; to: number }
  lane: number
  dimmed: boolean
  onSelect: (b: BookingHit) => void
}) {
  const geo = barGeometry(booking, bounds)
  if (!geo) return null

  const stage = bookingLifecycle(booking)
  const look = bookingBarLook(stage, colorFor(booking))
  const widthPx = (geo.width / 100) * gridWidth
  const who = booking.employee?.initials || booking.employee?.full_name || ''
  const purpose = booking.title || ''

  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={() => onSelect(booking)}
          className={cn(
            'pointer-events-auto absolute flex items-center gap-1 overflow-hidden rounded-[4px] px-1 text-left text-[11px] font-medium transition-opacity',
            dimmed && 'opacity-25',
            look.strike && 'line-through',
          )}
          style={{
            left: `${geo.left}%`,
            width: `${geo.width}%`,
            top: lane * LANE_HEIGHT + (LANE_HEIGHT - BAR_HEIGHT) / 2,
            height: BAR_HEIGHT,
            minWidth: 4,
            ...look.style,
            clipPath: jaggedClip(geo.clipLeft, geo.clipRight),
          }}
        >
          {who && widthPx >= BADGE_MIN_PX && (
            <span
              className={cn(
                'max-w-[50%] shrink-0 truncate rounded-[3px] px-1 py-px text-[10px] font-semibold leading-4',
                look.solid ? 'bg-black/30 text-white' : 'bg-muted text-foreground',
              )}
            >
              {who}
            </span>
          )}
          {widthPx >= TEXT_MIN_PX && <span className="truncate">{purpose}</span>}
          {stage === 'invoiced' && widthPx >= BADGE_MIN_PX && (
            <ReceiptText className="ml-auto size-3 shrink-0 opacity-70" />
          )}
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-72">
        <BookingHoverDetails booking={booking} color={colorFor(booking).background} />
      </HoverCardContent>
    </HoverCard>
  )
}

export function BookingTimeline({
  period,
  horizon,
  hours,
  bounds,
  resources,
  bookings,
  query,
  colorFor,
  today,
  resetKey,
  onSelectBooking,
  onSelectDay,
  onCreate,
  onResourceInfo,
}: {
  period: BookingPeriod
  horizon: Horizon
  hours: { from: number; to: number }
  bounds: { from: number; to: number }
  resources: TimelineResource[]
  bookings: BookingHit[]
  /** Sat = søgning i gang; bookinger uden match tones ned frem for at forsvinde. */
  query: string
  colorFor: BookingColorFn
  today: Date
  /** Skifter når filtrene gør — så sætter vi tilbage til første side. */
  resetKey: string
  onSelectBooking: (b: BookingHit) => void
  onSelectDay: (day: Date) => void
  onCreate: (resourceId: string, day: Date) => void
  /** Sat = ressourcenavnet får et info-ikon til højre (nøgletal + eksport). */
  onResourceInfo?: (resource: TimelineResource) => void
}) {
  const { t } = useTranslation()
  const gridRef = useRef<HTMLDivElement>(null)
  const gridWidth = useElementWidth(gridRef)
  const [page, setPage] = useState(1)

  // Et nyt filter giver en ny liste; side 4 af den gamle betyder intet i den
  // nye. Perioden nulstiller derimod IKKE — man vil se de samme ressourcer,
  // når man bladrer en uge frem.
  useEffect(() => setPage(1), [resetKey])

  const columns = useMemo(
    () => timelineColumns(period, horizon, hours, today),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [period, toISODate(horizon.start), toISODate(horizon.end), hours.from, hours.to, toISODate(today)],
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
      return { resource, packed, lanes: Math.max(1, ...packed.map((p) => p.lane + 1)) }
    })
  }, [resources, bookings])

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const visibleRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  // Sidevindue: højst MAX_PAGE_BUTTONS knapper, centreret om aktuel side.
  const pageButtons = Array.from(
    {
      length: Math.min(MAX_PAGE_BUTTONS, pageCount),
    },
    (_, i) =>
      Math.max(
        1,
        Math.min(safePage - Math.floor(MAX_PAGE_BUTTONS / 2), pageCount - MAX_PAGE_BUTTONS + 1),
      ) + i,
  )
  const gridCols = `repeat(${columns.length}, minmax(0, 1fr))`
  const rowCols = `${LABEL_WIDTH}px 1fr`
  const showWeekday = period !== 'day'
  const narrowWeekday = columns.length > 14

  // Båndene over kolonnerne: i dagsvisning selve dagen, ellers måned + uge.
  const bands = useMemo(() => {
    if (period === 'day')
      return [
        segments(columns, () => 'day').map((s) => ({
          ...s,
          label: capFirst(longDayFormat.format(s.col.date)),
          tone: 0,
        })),
      ]
    const months = segments(columns, (c) => `${c.date.getFullYear()}-${c.date.getMonth()}`).map(
      (s) => {
        const width = s.end - s.start + 1
        return {
          ...s,
          label:
            width >= 5
              ? capFirst(monthFormat.format(s.col.date))
              : width >= 2
                ? capFirst(monthShortFormat.format(s.col.date).replace('.', ''))
                : '',
          tone: s.col.date.getMonth() % 2,
        }
      },
    )
    const weeks = segments(columns, (c) => String(startOfWeek(c.date).getTime())).map((s) => {
      const week = isoWeek(s.col.date)
      const width = s.end - s.start + 1
      return {
        ...s,
        label: width >= 4 ? t('bookingCalendar.week', { week }) : width >= 2 ? String(week) : '',
        tone: week % 2,
      }
    })
    return [months, weeks]
  }, [columns, period, t])

  if (rows.length === 0)
    return (
      <p className="py-12 text-center text-[13px] text-muted-foreground">
        {t('bookingCalendar.noResources')}
      </p>
    )

  return (
    // Rammen ligger UDEN OM den vandrette rulning, så sidebjælken bliver
    // stående, mens gitteret ruller ind under den.
    <div className="overflow-hidden rounded-md border border-border bg-panel">
      <div className="overflow-x-auto">
        <div style={{ minWidth: LABEL_WIDTH + columns.length * MIN_COL_WIDTH }}>
          {bands.map((band, bandIndex) => (
            <div
              key={bandIndex}
              className="grid border-b border-border/60"
              style={{ gridTemplateColumns: rowCols }}
            >
              <div className="sticky left-0 z-20 border-r border-border bg-panel" />
              <div className="grid" style={{ gridTemplateColumns: gridCols }}>
                {band.map((seg) => (
                  <div
                    key={seg.col.key}
                    title={seg.label || undefined}
                    className={cn(
                      'truncate border-l border-border/60 px-1.5 py-0.5 text-[11px] text-muted-foreground first:border-l-0',
                      bandIndex === 0 && 'font-medium',
                      seg.tone === 0 ? 'bg-muted/50' : 'bg-muted/15',
                    )}
                    style={{ gridColumn: `${seg.start + 1} / ${seg.end + 2}` }}
                  >
                    {seg.label}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Datohoved: ugedag over dato (weekend og helligdage i rødt), eller
              klokkeslæt i dagsvisning. */}
          <div className="grid border-b border-border" style={{ gridTemplateColumns: rowCols }}>
            <div className="sticky left-0 z-20 flex items-end border-r border-border bg-panel px-2 py-1 text-[11px] font-medium text-muted-foreground">
              {t('bookingFlow.resource')}
            </div>
            <div className="grid" style={{ gridTemplateColumns: gridCols }}>
              {columns.map((col) => {
                const holiday = holidayOn(col.date)
                const red = columnRed(col)
                return (
                  <button
                    key={col.key}
                    type="button"
                    onClick={() => onSelectDay(col.date)}
                    title={
                      holiday
                        ? `${longDayFormat.format(col.date)} — ${t(`bookingCalendar.holiday.${holiday.key}`)}`
                        : longDayFormat.format(col.date)
                    }
                    className={cn(
                      'flex flex-col items-center border-l border-border/60 px-0.5 py-1 text-[11px] tabular-nums transition-colors first:border-l-0 hover:bg-accent/50',
                      columnTint(col),
                      red ? 'text-status-bad' : 'text-muted-foreground',
                      col.today && 'font-semibold',
                    )}
                  >
                    {showWeekday && (
                      <span>
                        {(narrowWeekday ? weekdayNarrowFormat : weekdayFormat)
                          .format(col.date)
                          .replace('.', '')}
                      </span>
                    )}
                    <span
                      className={cn(
                        col.today && !red && 'rounded-[4px] bg-accent px-1 text-foreground',
                      )}
                    >
                      {col.hour != null ? String(col.hour).padStart(2, '0') : col.date.getDate()}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {visibleRows.map(({ resource, packed, lanes }, rowIndex) => (
            <div
              key={resource.id}
              className="grid border-b border-border/60 last:border-b-0"
              style={{ gridTemplateColumns: rowCols }}
            >
              <div className="sticky left-0 z-20 flex min-w-0 items-center gap-1 border-r border-border bg-panel px-2 py-1">
                <div className="flex min-w-0 flex-1 flex-col justify-center">
                  <span className="truncate text-[12px] font-medium">{resource.name}</span>
                  {resource.location && (
                    <span className="truncate text-[11px] text-muted-foreground">
                      {resource.location}
                    </span>
                  )}
                </div>
                {onResourceInfo && (
                  <button
                    type="button"
                    // Info, ikke redigering: ressourcens stamdata rettes på
                    // /booking/resources. Her er det nøgletal og eksport.
                    aria-label={t('bookingCalendar.resourceInfo')}
                    title={t('bookingCalendar.resourceInfo')}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation()
                      onResourceInfo(resource)
                    }}
                  >
                    <Info className="size-3.5" />
                  </button>
                )}
              </div>
              <div className="relative" style={{ height: lanes * LANE_HEIGHT }}>
                {/* Tomme celler bagved: et klik booker ressourcen netop dér. */}
                <div
                  ref={rowIndex === 0 ? gridRef : undefined}
                  className="absolute inset-0 grid"
                  style={{ gridTemplateColumns: gridCols }}
                >
                  {columns.map((col) => (
                    <button
                      key={col.key}
                      type="button"
                      aria-label={t('bookingCalendar.createHere', {
                        resource: resource.name,
                        date: dayFormat.format(col.date),
                      })}
                      onClick={() => onCreate(resource.id, col.date)}
                      className={cn(
                        'border-l border-border/40 transition-colors first:border-l-0 hover:bg-accent/50',
                        columnTint(col),
                        col.today && col.hour == null && 'bg-accent/40',
                      )}
                    />
                  ))}
                </div>
                <div className="pointer-events-none absolute inset-0">
                  {packed.map(({ booking, lane }) => (
                    <BookingBar
                      key={booking.id}
                      booking={booking}
                      colorFor={colorFor}
                      gridWidth={gridWidth}
                      bounds={bounds}
                      lane={lane}
                      dimmed={!!query && !bookingMatches(booking, query)}
                      onSelect={onSelectBooking}
                    />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sidebjælke som i tabellerne: ti rækker ad gangen. */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2">
        <span className="text-xs text-muted-foreground">
          {t('dataTable.showing', {
            from: rows.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1,
            to: Math.min(safePage * PAGE_SIZE, rows.length),
            total: rows.length,
            entity: t('nav.bookingResources').toLowerCase(),
          })}
        </span>
        {pageCount > 1 && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              disabled={safePage <= 1}
              onClick={() => setPage(safePage - 1)}
            >
              <ChevronLeft className="size-3.5" /> {t('dataTable.previous')}
            </Button>
            {pageButtons.map((n) => (
              <Button
                key={n}
                variant={n === safePage ? 'outline' : 'ghost'}
                size="sm"
                className="h-7 w-7 p-0 text-xs"
                onClick={() => setPage(n)}
              >
                {n}
              </Button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              disabled={safePage >= pageCount}
              onClick={() => setPage(safePage + 1)}
            >
              {t('dataTable.next')} <ChevronRight className="size-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

/** Forklaring til statusbehandlingen — farven er kategoriens, formen er status'. */
export function StatusLegend({
  stages,
  className,
}: {
  stages: BookingLifecycle[]
  className?: string
}) {
  const { t } = useTranslation()
  if (stages.length === 0) return null
  const neutral = { background: 'var(--booking-category-none)', color: 'var(--foreground)' }
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground',
        className,
      )}
    >
      {stages.map((s) => {
        const look = bookingBarLook(s, neutral)
        return (
          <span key={s} className="flex items-center gap-1.5">
            <span
              className="h-3 w-6 shrink-0 rounded-[3px]"
              style={{ ...look.style, color: undefined }}
            />
            <span className={cn('truncate', look.strike && 'line-through')}>
              {t(BOOKING_LIFECYCLE_KEYS[s])}
            </span>
          </span>
        )
      })}
    </div>
  )
}
