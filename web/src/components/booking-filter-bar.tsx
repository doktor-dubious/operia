import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarDays, Check, ChevronDown, RotateCcw, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DateRangePicker } from '@/components/booking-mini-calendar'
import { BOOKING_LIFECYCLES, BOOKING_LIFECYCLE_KEYS } from '@/lib/booking'
import {
  RESOURCE_ALL,
  RESOURCE_WITH_BOOKINGS,
  type BookingCalendarSearch,
  type BookingPeriod,
  type BookingStatusFilter,
  type Horizon,
} from '@/lib/booking-view'
import {
  addDays,
  capFirst,
  dayFormat,
  isoWeek,
  monthFormat,
  startOfDay,
  toISODate,
} from '@/lib/calendar'
import { cn } from '@/lib/utils'

// Den fælles værktøjslinje over kalenderen og tidslinjen: ressource, datoer,
// status, fritekst. Rækkefølgen er bevidst den samme som filtrenes rækkevidde
// — først HVILKE rækker, så HVILKEN periode, så hvilke bookinger.

export type FilterResource = {
  id: string
  name: string
  location: string | null
  is_active: boolean
  category_id: string | null
}

/** Ressourcevælgeren: søgbar dropdown med <Alle> øverst, ellers pr. kategori. */
function ResourcePicker({
  value,
  resources,
  categories,
  onChange,
}: {
  value: string
  resources: FilterResource[]
  categories: { id: string; name: string }[]
  onChange: (v: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const groups = useMemo(() => {
    const byCategory = new Map<string, FilterResource[]>()
    for (const r of resources) {
      const key = r.category_id ?? ''
      const list = byCategory.get(key) ?? []
      list.push(r)
      byCategory.set(key, list)
    }
    const named = categories
      .filter((c) => byCategory.has(c.id))
      .map((c) => ({ key: c.id, name: c.name, items: byCategory.get(c.id)! }))
    const loose = byCategory.get('')
    return loose ? [...named, { key: 'none', name: t('bookingCalendar.noCategory'), items: loose }] : named
  }, [resources, categories, t])

  const selected = resources.find((r) => r.id === value)
  const label =
    value === RESOURCE_WITH_BOOKINGS
      ? t('bookingCalendar.onlyWithBookings')
      : (selected?.name ?? t('bookingCalendar.allResources'))

  const pick = (v: string) => {
    onChange(v)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="w-56 justify-between gap-1.5 font-normal">
          <span className="truncate">
            <span className="text-muted-foreground">{t('bookingCalendar.resourceLabel')}: </span>
            {label}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder={t('bookingCalendar.resourceSearch')} />
          <CommandList>
            <CommandEmpty>{t('bookingCalendar.noMatch')}</CommandEmpty>
            <CommandGroup>
              <PickerItem
                label={t('bookingCalendar.allResources')}
                selected={value === RESOURCE_ALL}
                onSelect={() => pick(RESOURCE_ALL)}
              />
              <PickerItem
                label={t('bookingCalendar.onlyWithBookings')}
                selected={value === RESOURCE_WITH_BOOKINGS}
                onSelect={() => pick(RESOURCE_WITH_BOOKINGS)}
              />
            </CommandGroup>
            {groups.map((g) => (
              <div key={g.key}>
                <CommandSeparator />
                <CommandGroup heading={g.name}>
                  {g.items.map((r) => (
                    <PickerItem
                      key={r.id}
                      label={r.name}
                      hint={r.location ?? undefined}
                      muted={!r.is_active}
                      selected={value === r.id}
                      onSelect={() => pick(r.id)}
                    />
                  ))}
                </CommandGroup>
              </div>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function PickerItem({
  label,
  hint,
  muted,
  selected,
  onSelect,
}: {
  label: string
  hint?: string
  muted?: boolean
  selected: boolean
  onSelect: () => void
}) {
  return (
    <CommandItem value={`${label} ${hint ?? ''}`} onSelect={onSelect} className="gap-2">
      <Check className={cn('size-3.5 shrink-0', selected ? 'opacity-100' : 'opacity-0')} />
      <span className={cn('min-w-0 flex-1 truncate', muted && 'text-muted-foreground')}>{label}</span>
      {hint && <span className="shrink-0 truncate text-[11px] text-muted-foreground">{hint}</span>}
    </CommandItem>
  )
}

/**
 * Datofilteret. Det ER horisonten: et valg her flytter tidslinjen frem for at
 * skjule bookinger inde i en anden periode — ellers ville man kunne vælge en
 * uge i maj og undre sig over et tomt gitter i september.
 */
export function BookingDateFilter({
  period,
  horizon,
  today,
  onChange,
}: {
  period: BookingPeriod
  horizon: Horizon
  today: Date
  onChange: (next: BookingCalendarSearch) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const apply = (next: BookingCalendarSearch) => {
    onChange(next)
    setOpen(false)
  }
  const range = (from: Date, to: Date) =>
    apply({ period: 'range', from: toISODate(from), to: toISODate(to) })

  const presets: { key: string; run: () => void }[] = [
    { key: 'today', run: () => apply({ period: 'day', date: toISODate(today) }) },
    { key: 'thisWeek', run: () => apply({ period: 'week', date: toISODate(today) }) },
    { key: 'thisMonth', run: () => apply({ period: 'month', date: toISODate(today) }) },
    { key: 'next7', run: () => range(today, addDays(today, 6)) },
    { key: 'next30', run: () => range(today, addDays(today, 29)) },
    { key: 'prev30', run: () => range(addDays(today, -29), today) },
  ]

  // Knappen navngiver ALTID det, der er på skærmen. Et "alle datoer", der blev
  // stående, når man valgte Denne uge, var en usandhed — og tidslinjen kan i
  // sagens natur ikke vise alle datoer: den tegner altid en afgrænset horisont.
  const holdsToday = horizon.start <= today && today <= horizon.end
  const label =
    period === 'range'
      ? `${dayFormat.format(horizon.start)} – ${dayFormat.format(horizon.end)}`
      : period === 'day'
        ? holdsToday
          ? t('bookingCalendar.preset.today')
          : dayFormat.format(horizon.start)
        : period === 'week'
          ? holdsToday
            ? t('bookingCalendar.preset.thisWeek')
            : t('bookingCalendar.week', { week: isoWeek(horizon.start) })
          : holdsToday
            ? t('bookingCalendar.preset.thisMonth')
            : capFirst(monthFormat.format(horizon.start))

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 font-normal">
          <CalendarDays className="size-4 text-muted-foreground" />
          <span className="truncate">{label}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-auto gap-4 p-3">
        <div className="flex w-40 flex-col">
          {presets.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={p.run}
              className="rounded-[4px] px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-accent/60"
            >
              {t(`bookingCalendar.preset.${p.key}`)}
            </button>
          ))}
        </div>
        <div className="border-l border-border pl-4">
          <DateRangePicker
            rangeStart={horizon.start}
            rangeEnd={horizon.end}
            today={today}
            onApply={(from, to) => range(from, to)}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function BookingFilterBar({
  period,
  today,
  resource,
  resources,
  categories,
  status,
  query,
  onChange,
  onQueryChange,
  actions,
}: {
  period: BookingPeriod
  today: Date
  resource: string
  resources: FilterResource[]
  categories: { id: string; name: string }[]
  status: BookingStatusFilter
  query: string
  onChange: (next: BookingCalendarSearch) => void
  /** Fritekst skrives lokalt og spejles i URL'en — derfor sin egen kanal. */
  onQueryChange: (q: string) => void
  actions?: React.ReactNode
}) {
  const { t } = useTranslation()
  const dirty = resource !== RESOURCE_ALL || status !== 'any' || !!query || period === 'range'

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ResourcePicker
        value={resource}
        resources={resources}
        categories={categories}
        onChange={(v) => onChange({ resource: v })}
      />
      <Select
        value={status}
        onValueChange={(v) => onChange({ status: v as BookingStatusFilter })}
      >
        <SelectTrigger size="sm" className="w-44">
          <span className="truncate">
            <span className="text-muted-foreground">{t('bookingPage.status')}: </span>
            <SelectValue />
          </span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="any">{t('bookingCalendar.statusAny')}</SelectItem>
          {BOOKING_LIFECYCLES.map((s) => (
            <SelectItem key={s} value={s}>
              {t(BOOKING_LIFECYCLE_KEYS[s])}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="relative min-w-56 flex-1">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          placeholder={t('bookingCalendar.searchPlaceholder')}
          className="h-8 pl-8 pr-8"
          onChange={(e) => onQueryChange(e.target.value)}
        />
        {query && (
          <button
            type="button"
            aria-label={t('bookingCalendar.clearSearch')}
            onClick={() => onQueryChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      {dirty && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onQueryChange('')
            onChange({
              resource: RESOURCE_ALL,
              status: 'any',
              period: 'week',
              date: toISODate(startOfDay(today)),
            })
          }}
        >
          <RotateCcw className="size-3.5" /> {t('bookingCalendar.resetFilters')}
        </Button>
      )}
      {actions}
    </div>
  )
}
