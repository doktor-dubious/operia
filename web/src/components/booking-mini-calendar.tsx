import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  addDays,
  capFirst,
  longDayFormat,
  monthFormat,
  toISODate,
  weekdayNarrowFormat,
} from '@/lib/calendar'
import { holidayOn } from '@/lib/holidays'
import { cn } from '@/lib/utils'

// Månedsgitteret bag både den lille kalender til venstre for tidslinjen og
// periodevælgeren. Dansk uge (mandag først, som resten af appen) og et fast
// 6-ugers gitter, så højden ikke hopper når måneden skifter.

/** Ugedagsinitialer, mandag først (1. juni 2026 er en mandag). */
const WEEKDAY_LABELS = Array.from({ length: 7 }, (_, i) =>
  weekdayNarrowFormat.format(new Date(2026, 5, 1 + i)).toUpperCase(),
)

/** De 42 dage i månedens gitter — inkl. gråtonede dage fra nabomånederne. */
function monthGridDays(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const lead = (first.getDay() + 6) % 7 // mandag = 0
  const start = addDays(first, -lead)
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

function MonthGrid({
  month,
  today,
  from,
  to,
  onDayDown,
  onDayEnter,
  onDayClick,
}: {
  month: Date
  today: Date
  /** Markeret periode (begge inkl.), null = ingen markering. */
  from: Date | null
  to: Date | null
  onDayDown?: (d: Date) => void
  onDayEnter?: (d: Date) => void
  onDayClick?: (d: Date) => void
}) {
  // Nøglen frem for datoen: en ny Date for samme måned må ikke regne gitteret om.
  const monthKey = `${month.getFullYear()}-${month.getMonth()}`
  const days = useMemo(
    () => monthGridDays(month),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [monthKey],
  )
  const todayISO = toISODate(today)

  return (
    <div className="grid grid-cols-7 gap-y-0.5">
      {WEEKDAY_LABELS.map((w, i) => (
        <span
          key={i}
          className="pb-1 text-center text-[11px] font-medium text-muted-foreground"
          aria-hidden
        >
          {w}
        </span>
      ))}
      {days.map((d) => {
        const outside = d.getMonth() !== month.getMonth()
        const inRange = !!from && !!to && d >= from && d <= to
        const isStart = !!from && toISODate(d) === toISODate(from)
        const isEnd = !!to && toISODate(d) === toISODate(to)
        const weekend = d.getDay() === 0 || d.getDay() === 6
        const holiday = holidayOn(d)
        return (
          <button
            key={d.getTime()}
            type="button"
            title={holiday ? longDayFormat.format(d) : undefined}
            // Pointer-events dækker både mus og touch; preventDefault holder
            // tekstmarkering ude af et træk hen over datoerne.
            onPointerDown={(e) => {
              e.preventDefault()
              onDayDown?.(d)
            }}
            onPointerEnter={() => onDayEnter?.(d)}
            onClick={() => onDayClick?.(d)}
            className={cn(
              'relative h-7 select-none text-center text-[12px] tabular-nums transition-colors',
              inRange
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-accent/60',
              inRange && isStart && 'rounded-l-[4px]',
              inRange && isEnd && 'rounded-r-[4px]',
              !inRange && 'rounded-[4px]',
              !inRange && outside && 'text-muted-foreground/50',
              !inRange && !outside && weekend && 'text-muted-foreground',
              !inRange && !outside && holiday?.official && 'text-status-bad',
              !inRange && toISODate(d) === todayISO && 'font-semibold text-foreground ring-1 ring-inset ring-border',
            )}
          >
            {d.getDate()}
          </button>
        )
      })}
    </div>
  )
}

function MonthHeader({
  month,
  onPrev,
  onNext,
}: {
  month: Date
  onPrev: () => void
  onNext: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-between">
      <span className="text-[13px] font-medium">{capFirst(monthFormat.format(month))}</span>
      <div className="flex items-center">
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          onClick={onPrev}
          aria-label={t('bookingCalendar.prevMonth')}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          onClick={onNext}
          aria-label={t('bookingCalendar.nextMonth')}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  )
}

/**
 * Periodevælgeren bag datolinjen over tidslinjen: to måneder side om side,
 * første klik sætter starten, næste klik slutningen (bytter om hvis der
 * klikkes bagud). Perioden anvendes når begge ender er valgt.
 */
export function DateRangePicker({
  rangeStart,
  rangeEnd,
  today,
  onApply,
}: {
  rangeStart: Date
  rangeEnd: Date
  today: Date
  onApply: (from: Date, to: Date) => void
}) {
  const { t } = useTranslation()
  const [month, setMonth] = useState(() => new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1))
  const [from, setFrom] = useState<Date | null>(rangeStart)
  const [to, setTo] = useState<Date | null>(rangeEnd)
  const [hover, setHover] = useState<Date | null>(null)

  const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1)
  // Mens kun starten er valgt, forhåndsvises perioden hen til musen.
  const preview = from && !to && hover ? (hover < from ? { from: hover, to: from } : { from, to: hover }) : null
  const shownFrom = preview?.from ?? from
  const shownTo = preview?.to ?? to

  const pick = (d: Date) => {
    if (!from || to) {
      setFrom(d)
      setTo(null)
      return
    }
    const [a, b] = d < from ? [d, from] : [from, d]
    setFrom(a)
    setTo(b)
    onApply(a, b)
  }

  const label = (d: Date | null) => (d ? longDayFormat.format(d) : t('bookingCalendar.pickDate'))

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-4 text-center">
        <div>
          <p className="text-[13px] font-medium">{t('bookingCalendar.startDate')}</p>
          <p className="truncate text-xs text-muted-foreground">{label(from)}</p>
        </div>
        <div>
          <p className="text-[13px] font-medium">{t('bookingCalendar.endDate')}</p>
          <p className="truncate text-xs text-muted-foreground">{label(to)}</p>
        </div>
      </div>
      <div className="flex items-start gap-5">
        {[month, nextMonth].map((m, i) => (
          <div key={i} className="flex w-[15rem] flex-col gap-2">
            {i === 0 ? (
              <MonthHeader
                month={m}
                onPrev={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
                onNext={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
              />
            ) : (
              <div className="flex h-7 items-center">
                <span className="text-[13px] font-medium">{capFirst(monthFormat.format(m))}</span>
              </div>
            )}
            <div onPointerLeave={() => setHover(null)}>
              <MonthGrid
                month={m}
                today={today}
                from={shownFrom}
                to={shownTo}
                onDayEnter={setHover}
                onDayClick={pick}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
