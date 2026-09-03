import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { AssetHistory } from '@/components/asset-history'
import { AssetSummary } from '@/components/asset-summary'
import { useCompanyContext } from '@/hooks/use-company-context'
import {
  addDays,
  compareUrgency,
  diffDays,
  effectiveEnd,
  endOfDay,
  entryOverlaps,
  fetchCalendarEntries,
  isDueSoon,
  isOverdue,
  parseISODate,
  startOfDay,
  stepAnchor,
  toISODate,
  viewRange,
  type CalendarEntry,
  type CalendarKind,
  type CalendarView,
} from '@/lib/asset-calendar'
import {
  capFirst,
  dayFormat,
  jaggedClip,
  longDayFormat,
  monthFormat,
  monthShortFormat,
  weekdayFormat,
} from '@/lib/calendar'
import type { AssetHit } from '@/lib/asset-lookup'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

// Aktivkalenderen: hvornår er aktiverne ude, og hvornår er de ledige igen?
//  - Dag: liste over alt der er ude på datoen.
//  - Uge/Måned/Periode: tidslinje med én række pr. aktiv og en bjælke pr.
//    periode; takkede kanter markerer at perioden fortsætter ud over visningen.
//  - År: 12 månedskort med nøgletal, klik åbner måneden.
// Tildelinger er uden slutdato og derfor slået fra som standard (opt-in via
// statusfilteret), så kalenderen ikke drukner i endeløse bjælker.

const KIND_COLOR: Record<CalendarKind, string> = {
  loan: 'var(--status-good-to-neutral)',
  service: 'var(--status-neutral-to-bad)',
  assigned: '#13315C', // som aktivtavlens tildelt-farve
}

const MAX_TIMELINE_ROWS = 150
const DUE_SOON_CHOICES = [3, 7, 14] as const

type UrgencyFilter = 'all' | 'overdue' | 'dueSoon'

function barColor(e: CalendarEntry, today: Date): string {
  return isOverdue(e, today) ? 'var(--status-bad)' : KIND_COLOR[e.kind]
}

function useCalendarEntries(companyId: string | null, rangeStart: Date, rangeEnd: Date) {
  return useQuery({
    queryKey: ['assets', 'calendar', companyId, toISODate(rangeStart), toISODate(rangeEnd)],
    enabled: !!companyId,
    queryFn: () => fetchCalendarEntries(companyId!, rangeStart, rangeEnd),
  })
}

function useNamedRows(table: 'asset_categories' | 'asset_locations', companyId: string | null) {
  return useQuery({
    queryKey: ['assets', 'calendar-options', table, companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from(table)
        .select('id, name')
        .eq('company_id', companyId!)
        .order('name')
      if (error) throw error
      return data ?? []
    },
  })
}

// Én tekstlinje om perioden: hvem har aktivet, og hvornår er det tilbage.
function entryText(e: CalendarEntry, t: TFunction, today: Date): string {
  const parts: string[] = []
  if (e.holder) parts.push(e.holder)
  if (e.kind === 'loan') {
    if (e.closed && e.end) parts.push(t('assetCalendar.returnedOn', { date: dayFormat.format(e.end) }))
    else if (e.due)
      parts.push(
        isOverdue(e, today)
          ? t('assetCalendar.overdueSince', { date: dayFormat.format(e.due) })
          : t('assetCalendar.dueOn', { date: dayFormat.format(e.due) }),
      )
    else parts.push(t('assetCalendar.openEnded'))
  } else if (e.kind === 'service') {
    parts.push(
      e.due
        ? t('assetCalendar.expectedBack', { date: dayFormat.format(e.due) })
        : t('assetCalendar.openEnded'),
    )
  } else {
    parts.push(t('assetCalendar.sinceDate', { date: dayFormat.format(e.start) }))
  }
  return parts.join(' · ')
}

function KindDot({ e, today }: { e: CalendarEntry; today: Date }) {
  return (
    <span
      className={cn('size-2.5 shrink-0 rounded-[2px]', e.closed && 'opacity-45')}
      style={{ backgroundColor: barColor(e, today) }}
    />
  )
}

// Listen bag både dagsvisningen og dato-popup'en.
function DayEntryList({
  entries,
  today,
  withinDays,
  onSelect,
}: {
  entries: CalendarEntry[]
  today: Date
  withinDays: number
  onSelect: (asset: AssetHit) => void
}) {
  const { t } = useTranslation()
  if (entries.length === 0)
    return <p className="py-8 text-center text-[13px] text-muted-foreground">{t('assetCalendar.empty')}</p>
  return (
    <div className="flex flex-col divide-y divide-border rounded-md border border-border bg-panel">
      {entries.map((e) => (
        <button
          key={e.key}
          type="button"
          onClick={() => onSelect(e.asset)}
          className="flex items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-accent/40"
        >
          <KindDot e={e} today={today} />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2">
              <span className="truncate text-[13px] font-medium">{e.asset.name}</span>
              {e.asset.asset_tag && (
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{e.asset.asset_tag}</span>
              )}
            </span>
            <span className="block truncate text-xs text-muted-foreground">{entryText(e, t, today)}</span>
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">{t(`assetCalendar.kind_${e.kind}`)}</span>
          {isOverdue(e, today) && (
            <span className="shrink-0 rounded-[4px] bg-status-bad px-1.5 py-0.5 text-[11px] font-medium text-white">
              {t('assetFlow.overdue')}
            </span>
          )}
          {!isOverdue(e, today) && isDueSoon(e, today, withinDays) && (
            <span className="shrink-0 rounded-[4px] border border-status-neutral-to-bad px-1.5 py-0.5 text-[11px] text-status-neutral-to-bad">
              {t('assetCalendar.dueSoonTag')}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

// Tidslinjen (uge/måned/periode): én række pr. aktiv, bjælke pr. periode.
function Timeline({
  rangeStart,
  rangeEnd,
  entries,
  today,
  withinDays,
  onSelectAsset,
  onSelectDay,
}: {
  rangeStart: Date
  rangeEnd: Date
  entries: CalendarEntry[]
  today: Date
  withinDays: number
  onSelectAsset: (asset: AssetHit) => void
  onSelectDay: (day: Date) => void
}) {
  const { t } = useTranslation()
  const dayCount = diffDays(rangeStart, rangeEnd) + 1
  const days = useMemo(
    () => Array.from({ length: dayCount }, (_, i) => addDays(rangeStart, i)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toISODate(rangeStart), dayCount],
  )

  // Én række pr. aktiv (et aktiv kan have flere perioder i visningen); mest
  // presserende øverst — det dækker også "prioritér forfaldne når pladsen er
  // trang", da overskydende rækker kappes nedefra.
  const rows = useMemo(() => {
    const byAsset = new Map<string, { asset: AssetHit; entries: CalendarEntry[] }>()
    for (const e of entries) {
      const row = byAsset.get(e.asset.id) ?? { asset: e.asset, entries: [] }
      row.entries.push(e)
      byAsset.set(e.asset.id, row)
    }
    return [...byAsset.values()].sort((a, b) => {
      const ea = [...a.entries].sort((x, y) => compareUrgency(x, y, today, withinDays))[0]
      const eb = [...b.entries].sort((x, y) => compareUrgency(x, y, today, withinDays))[0]
      return compareUrgency(ea, eb, today, withinDays)
    })
  }, [entries, today, withinDays])

  const visibleRows = rows.slice(0, MAX_TIMELINE_ROWS)
  const gridCols = `minmax(160px, 200px) repeat(${dayCount}, minmax(24px, 1fr))`
  const todayISO = toISODate(today)
  const showWeekday = dayCount <= 14

  if (rows.length === 0)
    return <p className="py-12 text-center text-[13px] text-muted-foreground">{t('assetCalendar.empty')}</p>

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-md border border-border bg-panel">
        <div style={{ minWidth: 160 + dayCount * 26 }}>
          {/* Datohoved — klik på en dag åbner dagens liste */}
          <div className="grid border-b border-border" style={{ gridTemplateColumns: gridCols }}>
            <div className="sticky left-0 z-20 border-r border-border bg-panel" />
            {days.map((d) => {
              const isToday = toISODate(d) === todayISO
              const weekend = d.getDay() === 0 || d.getDay() === 6
              return (
                <button
                  key={d.getTime()}
                  type="button"
                  onClick={() => onSelectDay(d)}
                  title={longDayFormat.format(d)}
                  className={cn(
                    'flex flex-col items-center border-l border-border/60 px-0.5 py-1 text-[11px] tabular-nums transition-colors hover:bg-accent/50',
                    weekend && 'bg-muted/40',
                    isToday ? 'font-semibold text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {showWeekday && <span>{weekdayFormat.format(d).replace('.', '')}</span>}
                  <span className={cn(isToday && 'rounded-[4px] bg-accent px-1')}>
                    {d.getDate() === 1 && !showWeekday
                      ? `1. ${monthShortFormat.format(d).replace('.', '')}`
                      : d.getDate()}
                  </span>
                </button>
              )
            })}
          </div>

          {visibleRows.map(({ asset, entries: rowEntries }) => (
            <div
              key={asset.id}
              className="grid border-b border-border/60 last:border-b-0"
              style={{ gridTemplateColumns: gridCols }}
            >
              <button
                type="button"
                onClick={() => onSelectAsset(asset)}
                className="sticky left-0 z-20 flex min-w-0 flex-col justify-center border-r border-border bg-panel px-2 py-1 text-left transition-colors hover:bg-accent/40"
              >
                <span className="truncate text-[12px] font-medium">{asset.name}</span>
                {asset.asset_tag && (
                  <span className="truncate font-mono text-[11px] text-muted-foreground">{asset.asset_tag}</span>
                )}
              </button>
              {/* Døgnbaggrunde (weekend/i dag) i samme gitter som bjælkerne */}
              {days.map((d, i) => (
                <div
                  key={d.getTime()}
                  className={cn(
                    'h-9 border-l border-border/40',
                    (d.getDay() === 0 || d.getDay() === 6) && 'bg-muted/40',
                    toISODate(d) === todayISO && 'bg-accent/40',
                  )}
                  style={{ gridColumn: i + 2, gridRow: 1 }}
                />
              ))}
              {rowEntries.map((e) => {
                const end = effectiveEnd(e, today)
                const clampedStart = Math.max(0, diffDays(rangeStart, e.start))
                const clampedEnd = end === null ? dayCount - 1 : Math.min(dayCount - 1, diffDays(rangeStart, end))
                if (clampedEnd < clampedStart) return null
                const truncLeft = startOfDay(e.start) < rangeStart
                const truncRight = end === null || end > endOfDay(rangeEnd)
                return (
                  <button
                    key={e.key}
                    type="button"
                    onClick={() => onSelectAsset(e.asset)}
                    title={`${e.asset.name} — ${entryText(e, t, today)}`}
                    className={cn(
                      'z-10 my-1.5 flex min-w-0 items-center overflow-hidden px-1.5 text-left text-[11px] font-medium text-white',
                      !truncLeft && !truncRight && 'rounded-[4px]',
                      e.closed && 'opacity-45',
                    )}
                    style={{
                      gridColumn: `${clampedStart + 2} / ${clampedEnd + 3}`,
                      gridRow: 1,
                      backgroundColor: barColor(e, today),
                      clipPath: jaggedClip(truncLeft, truncRight),
                    }}
                  >
                    <span className="truncate">{e.holder ?? t(`assetCalendar.kind_${e.kind}`)}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      {rows.length > MAX_TIMELINE_ROWS && (
        <p className="text-xs text-status-neutral-to-bad">
          {t('assetCalendar.rowsCapped', { count: MAX_TIMELINE_ROWS })}
        </p>
      )}
    </div>
  )
}

// Årsvisning: 12 månedskort med nøgletal — klik åbner måneden.
function YearOverview({
  year,
  entries,
  today,
  onPickMonth,
}: {
  year: number
  entries: CalendarEntry[]
  today: Date
  onPickMonth: (monthStart: Date) => void
}) {
  const { t } = useTranslation()
  const months = Array.from({ length: 12 }, (_, m) => {
    const start = new Date(year, m, 1)
    const end = new Date(year, m + 1, 0)
    const inMonth = entries.filter((e) => entryOverlaps(e, start, end, today))
    return {
      start,
      loans: inMonth.filter((e) => e.kind === 'loan').length,
      service: inMonth.filter((e) => e.kind === 'service').length,
      assigned: inMonth.filter((e) => e.kind === 'assigned').length,
      overdue: inMonth.filter((e) => isOverdue(e, today)).length,
    }
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
          <span className="text-[13px] font-medium">
            {capFirst(monthFormat.format(m.start))}
          </span>
          <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-[2px]" style={{ backgroundColor: KIND_COLOR.loan }} />
              {t('assetCalendar.loanCount', { count: m.loans })}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-[2px]" style={{ backgroundColor: KIND_COLOR.service }} />
              {t('assetCalendar.serviceCount', { count: m.service })}
            </span>
            {m.assigned > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-[2px]" style={{ backgroundColor: KIND_COLOR.assigned }} />
                {t('assetCalendar.assignedCount', { count: m.assigned })}
              </span>
            )}
          </span>
          {m.overdue > 0 && (
            <span className="text-xs font-medium text-status-bad">
              {t('assetBoard.overdueCount', { count: m.overdue })}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

export function AssetCalendar({
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

  const today = startOfDay(new Date())
  const anchor = dateISO ? parseISODate(dateISO) : today
  const { start: rangeStart, end: rangeEnd } = viewRange(view, anchor, {
    from: fromISO ? parseISODate(fromISO) : undefined,
    to: toISO ? parseISODate(toISO) : undefined,
  })

  const { data, isPending, refetch } = useCalendarEntries(companyId, rangeStart, rangeEnd)
  const { data: categories } = useNamedRows('asset_categories', companyId)
  const { data: locations } = useNamedRows('asset_locations', companyId)

  // Filtre er lokale (visning + dato er URL'en; filtrene er arbejdstilstand).
  const [term, setTerm] = useState('')
  const [categoryId, setCategoryId] = useState('all')
  const [locationId, setLocationId] = useState('all')
  const [kinds, setKinds] = useState<Set<CalendarKind>>(new Set(['loan', 'service']))
  const [urgency, setUrgency] = useState<UrgencyFilter>('all')
  const [dueDays, setDueDays] = useState(7)

  const [selectedAsset, setSelectedAsset] = useState<AssetHit | null>(null)
  const [dayDialog, setDayDialog] = useState<Date | null>(null)

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase()
    return (data?.entries ?? []).filter((e) => {
      if (!kinds.has(e.kind)) return false
      if (!entryOverlaps(e, rangeStart, rangeEnd, today)) return false
      if (categoryId !== 'all' && e.asset.category_id !== categoryId) return false
      if (locationId !== 'all' && e.asset.location_id !== locationId) return false
      if (urgency === 'overdue' && !isOverdue(e, today)) return false
      if (urgency === 'dueSoon' && !isOverdue(e, today) && !isDueSoon(e, today, dueDays)) return false
      if (q) {
        const hit = [e.asset.name, e.asset.asset_tag, e.asset.serial_no, e.asset.barcode, e.holder]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q))
        if (!hit) return false
      }
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, term, categoryId, locationId, kinds, urgency, dueDays, toISODate(rangeStart), toISODate(rangeEnd)])

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => compareUrgency(a, b, today, dueDays)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, dueDays],
  )

  const dayEntriesFor = (day: Date) =>
    sorted.filter((e) => entryOverlaps(e, day, day, today))

  const go = (next: { view?: CalendarView; date?: string; from?: string; to?: string }) =>
    onNavigate(next)

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

  const toggleKind = (k: CalendarKind) =>
    setKinds((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next.size === 0 ? prev : next // mindst ét statusfilter skal stå tændt
    })

  // Popup'en viser den friskeste udgave efter en handling (som aktivtavlen);
  // er aktivet ikke længere i kalenderens data, lukkes popup'en.
  const refreshSelected = async () => {
    const res = await refetch()
    setSelectedAsset((prev) => {
      if (!prev) return prev
      return res.data?.entries.find((e) => e.asset.id === prev.id)?.asset ?? null
    })
  }

  return (
    <div className="flex w-full flex-col gap-4">
      {/* Visning + periode */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-border">
          {(['day', 'week', 'month', 'year'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => go({ view: v, date: toISODate(anchor) })}
              className={cn(
                'px-3 py-1.5 text-[13px] font-medium transition-colors',
                view === v ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/40',
              )}
            >
              {t(`assetCalendar.view_${v}`)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => step(-1)} aria-label={t('assetCalendar.prev')}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => go({ view: view === 'custom' ? 'week' : view, date: toISODate(today) })}>
            {t('assetCalendar.today')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => step(1)} aria-label={t('assetCalendar.next')}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <span className="text-[13px] font-medium">{rangeLabel}</span>
        <span className="ml-auto flex items-center gap-1.5 text-[13px] text-muted-foreground">
          {t('assetCalendar.customRange')}
          <Input
            type="date"
            value={toISODate(rangeStart)}
            className="h-8 w-[8.5rem]"
            onChange={(e) => {
              if (e.target.value)
                go({ view: 'custom', from: e.target.value, to: toISODate(rangeEnd) })
            }}
          />
          –
          <Input
            type="date"
            value={toISODate(rangeEnd)}
            className="h-8 w-[8.5rem]"
            onChange={(e) => {
              if (e.target.value)
                go({ view: 'custom', from: toISODate(rangeStart), to: e.target.value })
            }}
          />
        </span>
      </div>

      {/* Filtre */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-56">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={term}
            placeholder={t('assetCalendar.searchPlaceholder')}
            className="h-8 pl-8"
            onChange={(e) => setTerm(e.target.value)}
          />
        </div>
        <Select value={categoryId} onValueChange={setCategoryId}>
          <SelectTrigger size="sm" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('assetCalendar.allCategories')}</SelectItem>
            {(categories ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={locationId} onValueChange={setLocationId}>
          <SelectTrigger size="sm" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('assetCalendar.allLocations')}</SelectItem>
            {(locations ?? []).map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1">
          {(['loan', 'service', 'assigned'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => toggleKind(k)}
              className={cn(
                'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors',
                kinds.has(k)
                  ? 'border-foreground/30 bg-accent text-foreground'
                  : 'border-border text-muted-foreground hover:bg-accent/40',
              )}
            >
              <span
                className={cn('size-2 rounded-[2px]', !kinds.has(k) && 'opacity-40')}
                style={{ backgroundColor: KIND_COLOR[k] }}
              />
              {t(`assetCalendar.kind_${k}`)}
            </button>
          ))}
        </div>
        <Select value={urgency} onValueChange={(v) => setUrgency(v as UrgencyFilter)}>
          <SelectTrigger size="sm" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('assetCalendar.urgencyAll')}</SelectItem>
            <SelectItem value="overdue">{t('assetCalendar.urgencyOverdue')}</SelectItem>
            <SelectItem value="dueSoon">{t('assetCalendar.urgencyDueSoon')}</SelectItem>
          </SelectContent>
        </Select>
        {urgency === 'dueSoon' && (
          <Select value={String(dueDays)} onValueChange={(v) => setDueDays(Number(v))}>
            <SelectTrigger size="sm" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DUE_SOON_CHOICES.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {t('assetCalendar.withinDays', { count: d })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {data?.capped && (
        <p className="text-xs text-status-neutral-to-bad">{t('assetCalendar.capped')}</p>
      )}

      {isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : view === 'day' ? (
        <DayEntryList
          entries={dayEntriesFor(anchor)}
          today={today}
          withinDays={dueDays}
          onSelect={setSelectedAsset}
        />
      ) : view === 'year' ? (
        <YearOverview
          year={anchor.getFullYear()}
          entries={sorted}
          today={today}
          onPickMonth={(m) => go({ view: 'month', date: toISODate(m) })}
        />
      ) : (
        <Timeline
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          entries={sorted}
          today={today}
          withinDays={dueDays}
          onSelectAsset={setSelectedAsset}
          onSelectDay={setDayDialog}
        />
      )}

      {/* Signaturforklaring */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {(['loan', 'service', 'assigned'] as const).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px]" style={{ backgroundColor: KIND_COLOR[k] }} />
            {t(`assetCalendar.kind_${k}`)}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] bg-status-bad" />
          {t('assetFlow.overdue')}
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="size-2.5 rounded-[2px] opacity-45"
            style={{ backgroundColor: KIND_COLOR.loan }}
          />
          {t('assetCalendar.legendClosed')}
        </span>
      </div>

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
              <DayEntryList
                entries={dayEntriesFor(dayDialog)}
                today={today}
                withinDays={dueDays}
                onSelect={(asset) => {
                  setDayDialog(null)
                  setSelectedAsset(asset)
                }}
              />
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Aktivets visitkort + historik (som aktivtavlens popup) */}
      <Dialog open={!!selectedAsset} onOpenChange={(open) => !open && setSelectedAsset(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          {selectedAsset && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">{selectedAsset.name}</DialogTitle>
              </DialogHeader>
              <AssetSummary asset={selectedAsset} onChanged={refreshSelected} />
              <div className="mt-2 flex flex-col gap-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t('assetFlow.history')}
                </p>
                <AssetHistory assetId={selectedAsset.id} />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
