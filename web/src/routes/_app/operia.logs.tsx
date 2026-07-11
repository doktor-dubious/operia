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

// Operia → Logs (platform-admins): Supabase-Studio-lignende fremviser af den
// centrale NIS2-revisionslog (audit_log), skrevet server-side af triggere på
// tværs af tenants. Faceter (tidsrum + handling), aktivitetshistogram, tæt
// tabel og en Live-tilstand der auto-genhenter.
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

function useAuditLog(live: boolean) {
  return useQuery({
    queryKey: ['operia-audit-log'],
    refetchInterval: live ? 5000 : false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('audit_log')
        .select('id, created_at, action, entity_type, entity_id, summary, company_id, detail')
        .order('created_at', { ascending: false })
        .limit(1000)
      if (error) throw error
      return data
    },
  })
}

function useCompanyNames() {
  return useQuery({
    queryKey: ['companies-for-logs'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from('companies').select('id, name')
      if (error) throw error
      return new Map(data.map((c) => [c.id, c.name]))
    },
  })
}

type LogRow = NonNullable<ReturnType<typeof useAuditLog>['data']>[number]

function dotColor(action: string) {
  if (/(deleted|removed|rejected|failed)/.test(action)) return 'bg-red-500'
  if (/(deactivated|anonymized|returned)/.test(action)) return 'bg-amber-500'
  if (/(created|invited|delivered|applied)/.test(action)) return 'bg-emerald-500'
  if (action.startsWith('parcel.')) return 'bg-sky-500'
  return 'bg-muted-foreground/40'
}

function message(r: LogRow) {
  const d = (r.detail ?? {}) as Record<string, unknown>
  const parts: string[] = []
  if (r.summary) parts.push(r.summary)
  if (d.from_status || d.to_status) parts.push(`${d.from_status ?? '—'} → ${d.to_status ?? '—'}`)
  if (r.action.startsWith('import.'))
    parts.push(`+${d.created ?? 0} / ~${d.updated ?? 0} / -${d.deactivated ?? 0} / ✗${d.rejected ?? 0}`)
  return parts.join('   ·   ')
}

const GRID = 'grid grid-cols-[16px_150px_180px_150px_1fr] items-center gap-3'

function LogsPage() {
  const { t } = useTranslation()
  const [live, setLive] = useState(false)
  const { data, isPending, refetch, isFetching } = useAuditLog(live)
  const { data: companyNames } = useCompanyNames()
  const [range, setRange] = useState('7d')
  const [actions, setActions] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')

  const rows = data ?? []
  const now = Date.now()
  const rangeMs = RANGES.find((r) => r.key === range)?.ms ?? null
  const cutoff = rangeMs ? now - rangeMs : 0

  const timeFiltered = rows.filter((r) => new Date(r.created_at).getTime() >= cutoff)

  const actionCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of timeFiltered) m.set(r.action, (m.get(r.action) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, range])

  const companyName = (id: string | null) => (id ? (companyNames?.get(id) ?? '—') : '—')

  const q = query.trim().toLowerCase()
  const filtered = timeFiltered.filter((r) => {
    if (actions.size && !actions.has(r.action)) return false
    if (q && !`${r.action} ${companyName(r.company_id)} ${message(r)}`.toLowerCase().includes(q))
      return false
    return true
  })

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

  const toggleAction = (action: string, on: boolean) =>
    setActions((prev) => {
      const next = new Set(prev)
      if (on) next.add(action)
      else next.delete(action)
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
              {actionCounts.map(([action, count]) => (
                <label key={action} className="flex cursor-pointer items-center gap-2 text-xs">
                  <Checkbox
                    checked={actions.has(action)}
                    onCheckedChange={(v) => toggleAction(action, v === true)}
                  />
                  <span className="flex-1 truncate font-mono text-[11px]">{action}</span>
                  <span className="text-muted-foreground">{count}</span>
                </label>
              ))}
              {!actionCounts.length && <p className="text-xs text-muted-foreground">—</p>}
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
                <span>{t('logsPage.colAction')}</span>
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
                    <span className={cn('size-1.5 rounded-full', dotColor(r.action))} />
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {dateFmt.format(new Date(r.created_at))}
                    </span>
                    <span className="truncate font-mono text-[11px]">{r.action}</span>
                    <span className="truncate text-muted-foreground">{companyName(r.company_id)}</span>
                    <span className="truncate">{message(r) || '—'}</span>
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
