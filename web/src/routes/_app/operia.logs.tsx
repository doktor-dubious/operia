import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'

// Operia → Logs (platform-admins): Supabase-Studio-lignende logfremviser over
// systemets revisionslog (parcel_events, append-only, på tværs af tenants).
// Faceter til venstre (tidsrum + hændelsestype), aktivitetshistogram øverst,
// tæt logtabel og en Live-tilstand der auto-genhenter.
export const Route = createFileRoute('/_app/operia/logs')({
  component: LogsPage,
})

const RANGES = [
  { key: '60m', ms: 60 * 60 * 1000, labelKey: 'logsPage.range60m' },
  { key: '24h', ms: 24 * 60 * 60 * 1000, labelKey: 'logsPage.range24h' },
  { key: '7d', ms: 7 * 24 * 60 * 60 * 1000, labelKey: 'logsPage.range7d' },
  { key: '30d', ms: 30 * 24 * 60 * 60 * 1000, labelKey: 'logsPage.range30d' },
  { key: 'all', ms: null as number | null, labelKey: 'logsPage.rangeAll' },
]

const dateFmt = new Intl.DateTimeFormat('da-DK', { dateStyle: 'short', timeStyle: 'medium' })
const BUCKETS = 48

function useLogs(live: boolean) {
  return useQuery({
    queryKey: ['operia-logs'],
    refetchInterval: live ? 5000 : false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('parcel_events')
        .select(
          'id, created_at, event_type, from_status, to_status, company:companies (name), parcel:parcels (barcode)',
        )
        .order('created_at', { ascending: false })
        .limit(1000)
      if (error) throw error
      return data
    },
  })
}

type LogRow = NonNullable<ReturnType<typeof useLogs>['data']>[number]

function dotColor(status: string | null) {
  switch (status) {
    case 'delivered':
      return 'bg-emerald-500'
    case 'rejected':
    case 'returned':
      return 'bg-red-500'
    case 'in_storage':
    case 'in_transit':
    case 'in_locker':
      return 'bg-amber-500'
    case 'registered':
      return 'bg-sky-500'
    default:
      return 'bg-muted-foreground/40'
  }
}

function message(r: LogRow) {
  const parts: string[] = []
  if (r.parcel?.barcode) parts.push(r.parcel.barcode)
  if (r.to_status) parts.push(`${r.from_status ?? '—'} → ${r.to_status}`)
  return parts.join('   ·   ')
}

const GRID = 'grid grid-cols-[16px_150px_130px_160px_1fr] items-center gap-3'

function LogsPage() {
  const { t } = useTranslation()
  const [live, setLive] = useState(false)
  const { data, isPending, refetch, isFetching } = useLogs(live)
  const [range, setRange] = useState('24h')
  const [types, setTypes] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')

  const rows = data ?? []
  const now = Date.now()
  const rangeMs = RANGES.find((r) => r.key === range)?.ms ?? null
  const cutoff = rangeMs ? now - rangeMs : 0

  const timeFiltered = rows.filter((r) => new Date(r.created_at).getTime() >= cutoff)

  // Facet-tællinger pr. hændelsestype (tidsfiltreret, ikke type-filtreret).
  const typeCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of timeFiltered) m.set(r.event_type, (m.get(r.event_type) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, range])

  const q = query.trim().toLowerCase()
  const filtered = timeFiltered.filter((r) => {
    if (types.size && !types.has(r.event_type)) return false
    if (q && !`${r.event_type} ${r.company?.name ?? ''} ${message(r)}`.toLowerCase().includes(q))
      return false
    return true
  })

  // Aktivitetshistogram: fordel hændelserne på BUCKETS tidsintervaller.
  const times = filtered.map((r) => new Date(r.created_at).getTime())
  const hiMax = rangeMs ? now : times.length ? Math.max(...times) : now
  const hiMin = rangeMs ? cutoff : times.length ? Math.min(...times) : now - 1
  const span = Math.max(1, hiMax - hiMin)
  const buckets = new Array(BUCKETS).fill(0)
  for (const time of times) {
    const i = Math.min(BUCKETS - 1, Math.max(0, Math.floor(((time - hiMin) / span) * BUCKETS)))
    buckets[i]++
  }
  const bucketMax = Math.max(1, ...buckets)

  const toggleType = (type: string, on: boolean) =>
    setTypes((prev) => {
      const next = new Set(prev)
      if (on) next.add(type)
      else next.delete(type)
      return next
    })

  return (
    <div className="flex min-h-full flex-col gap-3 py-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-medium">{t('nav.operiaLogs')}</h1>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Beta
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => refetch()}
            title={t('common.refresh')}
          >
            <RefreshCw className={cn('size-4', isFetching && 'animate-spin')} />
          </Button>
          <Button
            variant={live ? 'default' : 'outline'}
            size="sm"
            className="h-7 gap-1.5"
            onClick={() => setLive((v) => !v)}
          >
            <span
              className={cn(
                'inline-block size-1.5 rounded-full',
                live ? 'animate-pulse bg-emerald-400' : 'bg-muted-foreground',
              )}
            />
            {t('logsPage.live')}
          </Button>
        </div>
      </div>

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('logsPage.searchPlaceholder')}
        className="h-8"
      />

      <div className="flex h-14 items-end gap-px rounded-md border bg-muted/20 p-2">
        {buckets.map((c, i) => (
          <div
            key={i}
            className="flex-1 rounded-sm bg-primary/60"
            style={{ height: `${(c / bucketMax) * 100}%`, minHeight: c ? 2 : 0 }}
            title={String(c)}
          />
        ))}
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        <aside className="w-52 shrink-0 space-y-4">
          <div className="space-y-1.5">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
              {t('logsPage.timeRange')}
            </p>
            <Select value={range} onValueChange={setRange}>
              <SelectTrigger className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGES.map((r) => (
                  <SelectItem key={r.key} value={r.key}>
                    {t(r.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
              {t('logsPage.eventType')}
            </p>
            <div className="flex flex-col gap-1.5">
              {typeCounts.map(([type, count]) => (
                <label key={type} className="flex cursor-pointer items-center gap-2 text-xs">
                  <Checkbox
                    checked={types.has(type)}
                    onCheckedChange={(v) => toggleType(type, v === true)}
                  />
                  <span className="flex-1 truncate">{type}</span>
                  <span className="text-muted-foreground">{count}</span>
                </label>
              ))}
              {!typeCounts.length && <p className="text-xs text-muted-foreground">—</p>}
            </div>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          {isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <div className="overflow-hidden rounded-md border">
              <div
                className={cn(
                  GRID,
                  'border-b bg-muted/40 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70',
                )}
              >
                <span />
                <span>{t('logsPage.colDate')}</span>
                <span>{t('logsPage.colEvent')}</span>
                <span>{t('logsPage.colCompany')}</span>
                <span>{t('logsPage.colMessage')}</span>
              </div>
              <div className="max-h-[calc(100svh-22rem)] overflow-y-auto">
                {filtered.map((r) => (
                  <div
                    key={r.id}
                    className={cn(
                      GRID,
                      'border-b border-border/50 px-3 py-1.5 text-xs hover:bg-muted/40',
                    )}
                  >
                    <span className={cn('size-1.5 rounded-full', dotColor(r.to_status ?? r.from_status))} />
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {dateFmt.format(new Date(r.created_at))}
                    </span>
                    <span className="truncate">{r.event_type}</span>
                    <span className="truncate text-muted-foreground">{r.company?.name ?? '—'}</span>
                    <span className="truncate font-mono text-[11px]">{message(r) || '—'}</span>
                  </div>
                ))}
                {!filtered.length && (
                  <p className="px-3 py-10 text-center text-sm text-muted-foreground">
                    {t('logsPage.empty')}
                  </p>
                )}
              </div>
              <div className="border-t bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
                {t('logsPage.count', { count: filtered.length })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
