import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { BookingHoverDetails } from '@/components/booking-hover-details'
import type { BookingColorFn } from '@/components/booking-timeline'
import { bookingLifecycle, type BookingHit } from '@/lib/booking'
import { bookingBarLook } from '@/lib/booking-look'
import type { Horizon } from '@/lib/booking-view'
import {
  addDays,
  capFirst,
  diffDays,
  endOfDay,
  longDayFormat,
  monthShortFormat,
  startOfDay,
  startOfWeek,
  timeFormat,
  toISODate,
  weekdayFormat,
} from '@/lib/calendar'
import { holidayOn } from '@/lib/holidays'
import { cn } from '@/lib/utils'

// Kalendervisningen: måneden (eller den valgte periode) som et gitter af
// dagkort. Hvor tidslinjen svarer på "hvornår er ressourcen optaget", svarer
// kalenderen på "hvad sker der den dag" — derfor er brikkerne ordnet efter tid
// og bærer ressourcens navn, ikke omvendt.
//
// Perioden rundes op til hele uger, så gitteret altid har syv søjler: en dag
// giver én uge med dagen fremhævet, en måned giver sine 4–6 uger.

/** Højst så mange brikker i en dag; resten samles i "+N mere". */
const MAX_CHIPS = 3

type DayCell = {
  date: Date
  inRange: boolean
  bookings: BookingHit[]
}

function BookingChip({
  booking,
  colorFor,
  onSelect,
}: {
  booking: BookingHit
  colorFor: BookingColorFn
  onSelect: (b: BookingHit) => void
}) {
  const look = bookingBarLook(bookingLifecycle(booking), colorFor(booking))
  const label = booking.resource?.name ?? booking.title ?? '—'
  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={() => onSelect(booking)}
          className={cn(
            'flex w-full items-center gap-1 overflow-hidden rounded-[4px] px-1 py-0.5 text-left text-[11px] font-medium',
            look.strike && 'line-through',
          )}
          style={look.style}
        >
          {!booking.all_day && (
            <span className="shrink-0 tabular-nums opacity-80">
              {timeFormat.format(new Date(booking.starts_at))}
            </span>
          )}
          <span className="truncate">{label}</span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-72">
        <BookingHoverDetails booking={booking} color={colorFor(booking).background} />
      </HoverCardContent>
    </HoverCard>
  )
}

/** Dagens hele liste — det, "+N mere" viser, når man svæver over den. */
function DayOverflowList({
  day,
  bookings,
  colorFor,
  onSelect,
}: {
  day: Date
  bookings: BookingHit[]
  colorFor: BookingColorFn
  onSelect: (b: BookingHit) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[12px] font-medium">{capFirst(longDayFormat.format(day))}</p>
      <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
        {bookings.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => onSelect(b)}
            className="flex items-center gap-2 rounded-[4px] px-1 py-1 text-left text-[12px] transition-colors hover:bg-accent/50"
          >
            <span
              className="size-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: colorFor(b).background }}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{b.resource?.name ?? '—'}</span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {b.all_day
                  ? t('bookingCalendar.allDay')
                  : `${timeFormat.format(new Date(b.starts_at))}–${timeFormat.format(new Date(b.ends_at))}`}
                {b.employee?.full_name ? ` · ${b.employee.full_name}` : ''}
                {b.title ? ` · ${b.title}` : ''}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

export function BookingMonthGrid({
  horizon,
  bookings,
  colorFor,
  today,
  onSelectBooking,
  onSelectDay,
  onCreate,
}: {
  horizon: Horizon
  bookings: BookingHit[]
  colorFor: BookingColorFn
  today: Date
  onSelectBooking: (b: BookingHit) => void
  onSelectDay: (day: Date) => void
  onCreate: (day: Date) => void
}) {
  const { t } = useTranslation()

  const weeks = useMemo(() => {
    const first = startOfWeek(horizon.start)
    // Sidste uge skal rumme sidste dag i perioden — derfor op til søndagen.
    const last = addDays(startOfWeek(horizon.end), 6)
    const count = Math.ceil((diffDays(first, last) + 1) / 7)
    const startMs = startOfDay(horizon.start).getTime()
    const endMs = endOfDay(horizon.end).getTime()

    return Array.from({ length: count }, (_, w) =>
      Array.from({ length: 7 }, (_, d): DayCell => {
        const date = addDays(first, w * 7 + d)
        const dayStart = startOfDay(date).getTime()
        const dayEnd = endOfDay(date).getTime()
        return {
          date,
          inRange: dayEnd >= startMs && dayStart <= endMs,
          bookings: bookings
            .filter(
              (b) =>
                new Date(b.starts_at).getTime() <= dayEnd &&
                new Date(b.ends_at).getTime() > dayStart,
            )
            .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()),
        }
      }),
    )
  }, [horizon.start, horizon.end, bookings])

  const todayISO = toISODate(today)
  const weekdays = weeks[0] ?? []

  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-7 gap-1.5">
        {weekdays.map((cell) => {
          const red = cell.date.getDay() === 0 || cell.date.getDay() === 6
          return (
            <div
              key={cell.date.getDay()}
              className={cn(
                'px-1 text-[11px] font-medium',
                red ? 'text-status-bad' : 'text-muted-foreground',
              )}
            >
              {capFirst(weekdayFormat.format(cell.date).replace('.', ''))}
            </div>
          )
        })}
      </div>

      {weeks.map((week, w) => (
        <div key={w} className="grid grid-cols-7 gap-1.5">
          {week.map((cell) => {
            // Dage uden for perioden efterlades tomme — gitteret skal beholde
            // sine syv søjler, men de dage er ikke til at klikke på.
            if (!cell.inRange) return <div key={cell.date.getTime()} />

            const holiday = holidayOn(cell.date)
            const red = cell.date.getDay() === 0 || cell.date.getDay() === 6 || !!holiday?.official
            const isToday = toISODate(cell.date) === todayISO
            // Er der kun én i overskud, koster "+1 mere" lige så meget plads
            // som brikken selv — så vises den hellere.
            const shown =
              cell.bookings.length > MAX_CHIPS + 1
                ? cell.bookings.slice(0, MAX_CHIPS)
                : cell.bookings
            const hidden = cell.bookings.length - shown.length

            return (
              <div
                key={cell.date.getTime()}
                className="relative flex min-h-28 flex-col gap-1 rounded-md border border-border bg-panel p-1.5"
              >
                {/* Baggrunden booker dagen; brikkerne ovenpå åbner bookingen. */}
                <button
                  type="button"
                  aria-label={t('bookingCalendar.createOn', {
                    date: longDayFormat.format(cell.date),
                  })}
                  onClick={() => onCreate(cell.date)}
                  className="absolute inset-0 rounded-md transition-colors hover:bg-accent/40"
                />
                <div className="relative flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onSelectDay(cell.date)}
                    title={
                      holiday
                        ? `${longDayFormat.format(cell.date)} — ${t(`bookingCalendar.holiday.${holiday.key}`)}`
                        : longDayFormat.format(cell.date)
                    }
                    className={cn(
                      'flex size-6 items-center justify-center rounded-full text-[12px] font-medium tabular-nums transition-colors',
                      isToday
                        ? 'bg-primary text-primary-foreground'
                        : red
                          ? 'text-status-bad hover:bg-accent'
                          : 'hover:bg-accent',
                    )}
                  >
                    {cell.date.getDate()}
                  </button>
                  {/* Første i måneden får månedens navn med: i en periode over
                      flere måneder siger et "1" alene ingenting. */}
                  {cell.date.getDate() === 1 && (
                    <span className="text-[11px] text-muted-foreground">
                      {monthShortFormat.format(cell.date).replace('.', '')}
                    </span>
                  )}
                </div>
                <div className="relative flex flex-col gap-0.5">
                  {shown.map((b) => (
                    <BookingChip
                      key={b.id}
                      booking={b}
                      colorFor={colorFor}
                      onSelect={onSelectBooking}
                    />
                  ))}
                  {hidden > 0 && (
                    <HoverCard>
                      <HoverCardTrigger asChild>
                        <button
                          type="button"
                          onClick={() => onSelectDay(cell.date)}
                          className="rounded-[4px] px-1 py-0.5 text-left text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                        >
                          {t('bookingCalendar.more', { count: hidden })}
                        </button>
                      </HoverCardTrigger>
                      <HoverCardContent align="start" className="w-80">
                        <DayOverflowList
                          day={cell.date}
                          bookings={cell.bookings}
                          colorFor={colorFor}
                          onSelect={onSelectBooking}
                        />
                      </HoverCardContent>
                    </HoverCard>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
